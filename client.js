/* Browser half of Milvus for DSH. React is supplied by dsh's module loader. */
globalThis.__ModuleLoader__.load({
  id: '@zilliz/dsh-milvus',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const SETTINGS_NAMESPACE = 'dsh-milvus'
    const STATUS_NAMESPACE = 'dsh-milvus-status'

    const defaultIdentity = (kind) => kind === 'zilliz-cloud'
      ? { id: 'zilliz-cloud', name: 'Zilliz Cloud' }
      : { id: 'local', name: 'Local Milvus' }
    const nextIdentity = (kind, profiles) => {
      const base = defaultIdentity(kind)
      const ids = new Set(profiles.map((profile) => profile.id))
      const names = new Set(profiles.map((profile) => profile.name.trim().toLocaleLowerCase()))
      for (let ordinal = 1; ; ordinal += 1) {
        const identity = ordinal === 1
          ? base
          : { id: `${base.id}-${ordinal}`, name: `${base.name} ${ordinal}` }
        if (!ids.has(identity.id) && !names.has(identity.name.toLocaleLowerCase())) return identity
      }
    }
    const credentialRefFor = (id) => {
      const suffix = String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_')
      return suffix ? `DSH_MILVUS_${suffix}_TOKEN` : ''
    }
    const emptyDraft = (kind = 'local', profiles = []) => {
      const identity = nextIdentity(kind, profiles)
      return {
        ...identity,
        kind,
        endpoint: kind === 'local' ? 'http://127.0.0.1:19530' : '',
        database: kind === 'local' ? 'default' : '',
        credentialRef: kind === 'zilliz-cloud' ? credentialRefFor(identity.id) : '',
      }
    }
    const draftOf = (profile, profiles = []) => profile
      ? { ...emptyDraft(profile.kind, profiles), ...profile }
      : emptyDraft('local', profiles)

    /** A status-only credential projection. It never stores a token value. */
    class MilvusProfileController {
      constructor(scope, statusScope, api) {
        this.scope = scope
        this.statusScope = statusScope
        this.api = api
        this.listeners = new Set()
        this.credentials = {}
        this.pending = false
        this.error = ''
        this.snapshot = this.buildSnapshot()
        scope.subscribe(() => {
          this.readCredentials()
          this.emit()
        })
        statusScope.subscribe(() => this.emit())
        this.readCredentials()
      }

      buildSnapshot() {
        const section = this.scope.getSnapshot().value ?? {}
        const status = this.statusScope.getSnapshot().value ?? {}
        return {
          profiles: Array.isArray(section.profiles) ? section.profiles : [],
          activeProfileId: typeof section.activeProfileId === 'string' ? section.activeProfileId : '',
          credentials: this.credentials,
          checks: status.checks ?? {},
          pending: this.pending,
          error: this.error,
        }
      }

      getSnapshot = () => this.snapshot

      subscribe = (listener) => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      }

      emit() {
        this.snapshot = this.buildSnapshot()
        for (const listener of this.listeners) listener()
      }

      async readCredentials(additionalRefs = []) {
        const refs = [...new Set([
          ...this.getSnapshot().profiles.map((profile) => profile.credentialRef),
          ...additionalRefs,
        ].filter(Boolean))]
        if (!refs.length) {
          this.credentials = {}
          this.emit()
          return
        }
        try {
          const response = await this.api.credentials.describe({ refs })
          if (!response.result?.ok) return
          const rows = response.result.value?.credentials ?? {}
          this.credentials = Object.fromEntries(refs.map((ref) => [ref, {
            configured: rows[ref]?.configured === true,
            writable: rows[ref]?.writable !== false,
            source: rows[ref]?.source,
          }]))
          this.emit()
        } catch {
          // A status read must not clear a profile or claim its secret is absent.
        }
      }

      async run(work) {
        this.error = ''
        this.pending = true
        this.emit()
        try {
          return await work()
        } catch (error) {
          this.error = error instanceof Error ? error.message : 'Could not update the Milvus profile.'
          this.emit()
          return undefined
        } finally {
          this.pending = false
          this.emit()
        }
      }

      async saveProfile(draft, originalId) {
        const current = this.getSnapshot()
        const existing = current.profiles.find((item) => item.id === originalId)
        const identity = existing
          ? { id: String(draft.id).trim(), name: String(draft.name).trim() }
          : nextIdentity(draft.kind, current.profiles)
        const profile = {
          ...identity,
          kind: draft.kind,
          endpoint: String(draft.endpoint).trim(),
          ...(String(draft.database ?? '').trim() ? { database: String(draft.database).trim() } : {}),
          ...(draft.credentialRef?.trim() ? { credentialRef: draft.credentialRef.trim() } : {}),
        }
        if (profile.kind === 'zilliz-cloud' && !profile.credentialRef) profile.credentialRef = credentialRefFor(profile.id)
        return this.run(async () => {
          const profiles = existing
            ? current.profiles.map((item) => item.id === originalId ? profile : item)
            : [...current.profiles, profile]
          await this.scope.set('profiles', profiles)
          if (!current.activeProfileId) await this.scope.set('activeProfileId', profile.id)
          // Return the exact persisted shape. The settings subscription reaches
          // React asynchronously, so callers must not reconstruct a new
          // profile from their pre-save snapshot.
          return profile
        })
      }

      selectProfile(id) {
        return this.run(() => this.scope.set('activeProfileId', id))
      }

      removeProfile(id) {
        return this.run(async () => {
          const current = this.getSnapshot()
          const profiles = current.profiles.filter((profile) => profile.id !== id)
          const nextActive = current.activeProfileId === id ? (profiles[0]?.id ?? '') : current.activeProfileId
          // Preserve cross-field validity throughout the two separate writes.
          if (nextActive !== current.activeProfileId) await this.scope.set('activeProfileId', nextActive)
          await this.scope.set('profiles', profiles)
        })
      }

      writeCredential(profile, value) {
        if (!profile.credentialRef || !value) return Promise.resolve(false)
        return this.run(async () => {
          await this.api.credentials.set({ ref: profile.credentialRef, value })
          await this.readCredentials([profile.credentialRef])
          return this.credentials[profile.credentialRef]?.configured === true
        })
      }

      requestCheck(profile) {
        return this.run(() => this.statusScope.set('request', {
          profileId: profile.id,
          requestId: Date.now(),
        }))
      }

      refreshCredential(ref) {
        if (this.getSnapshot().profiles.some((profile) => profile.credentialRef === ref)) this.readCredentials()
      }
    }

    function Field({ label, hint, children }) {
      return h('label', { className: 'dsh-milvus-field' }, [
        h('span', { className: 'dsh-milvus-label', key: 'label' }, label), children,
        hint ? h('span', { className: 'dsh-milvus-hint', key: 'hint' }, hint) : null,
      ])
    }

    function MilvusSettingsCard({ controller }) {
      const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot)
      const [selectedId, setSelectedId] = React.useState(state.activeProfileId)
      const [draft, setDraft] = React.useState(() => draftOf(state.profiles.find((profile) => profile.id === state.activeProfileId), state.profiles))
      const [token, setToken] = React.useState('')
      const selected = state.profiles.find((profile) => profile.id === selectedId)
      const update = (field, value) => setDraft((previous) => ({ ...previous, [field]: value }))
      const updateKind = (kind) => setDraft((previous) => selected ? { ...previous, kind } : emptyDraft(kind, state.profiles))
      const choose = (id, profile) => {
        setSelectedId(id)
        setDraft(draftOf(profile ?? state.profiles.find((item) => item.id === id), state.profiles))
        setToken('')
      }
      const credential = draft.credentialRef ? state.credentials[draft.credentialRef] : undefined
      const check = selected ? state.checks[selected.id] : undefined

      return h('li', { className: 'dsh-milvus-card' }, [
        h('h3', { key: 'title' }, 'Milvus for DSH'),
        h('p', { className: 'dsh-milvus-intro', key: 'intro' }, 'Add a fixed Milvus endpoint and database. Tokens are write-only dsh Credentials, never chat or settings.'),
        state.error ? h('p', { role: 'alert', className: 'dsh-milvus-error', key: 'error' }, state.error) : null,
        h(Field, { label: 'Profile', key: 'profile' }, h('select', { value: selectedId, disabled: state.pending, onChange: (event) => choose(event.target.value) }, [
          h('option', { value: '', key: 'new' }, 'Create a new profile'),
          ...state.profiles.map((profile) => h('option', { value: profile.id, key: profile.id }, profile.name)),
        ])),
        h('div', { className: 'dsh-milvus-grid', key: 'fields' }, [
          h(Field, { label: 'Deployment', hint: selected ? 'Create another profile to use a different deployment type.' : '', key: 'kind' }, h('select', { value: draft.kind, disabled: state.pending || Boolean(selected), onChange: (event) => updateKind(event.target.value) }, [
            h('option', { value: 'local', key: 'local' }, 'Local Milvus Standalone'),
            h('option', { value: 'zilliz-cloud', key: 'cloud' }, 'Zilliz Cloud'),
          ])),
          h(Field, { label: 'Database (optional)', key: 'database' }, h('input', { value: draft.database, disabled: state.pending, onChange: (event) => update('database', event.target.value) })),
        ]),
        h(Field, { label: 'Endpoint', hint: draft.kind === 'zilliz-cloud' ? 'Zilliz Cloud requires HTTPS.' : 'Example: http://127.0.0.1:19530', key: 'endpoint' }, h('input', { value: draft.endpoint, disabled: state.pending, onChange: (event) => update('endpoint', event.target.value) })),
        draft.kind === 'zilliz-cloud' && draft.credentialRef ? h(Field, { label: 'Zilliz Cloud token', hint: selected ? (credential?.configured ? `Configured${credential.source ? ` via ${credential.source}` : ''}${credential.writable ? '' : ' (read-only)'}.` : 'Not configured. A saved value is never shown again.') : 'Required. It will be stored in dsh Credentials when you create this profile.', key: 'token' }, h('div', { className: 'dsh-milvus-row' }, [
          h('input', { type: 'password', autoComplete: 'new-password', value: token, disabled: state.pending || credential?.writable === false, onChange: (event) => setToken(event.target.value), key: 'input' }),
          selected ? h('button', { type: 'button', disabled: state.pending || !token || credential?.writable === false, onClick: async () => { if (await controller.writeCredential(draft, token)) setToken('') }, key: 'save' }, 'Save token') : null,
        ])) : null,
        selected ? h('div', { className: 'dsh-milvus-check', key: 'check' }, [
          h('button', { type: 'button', disabled: state.pending, onClick: () => controller.requestCheck(selected), key: 'button' }, 'Test connection'),
          check ? h('span', { key: 'status', 'data-state': check.state }, `${check.state}: ${check.message}`) : h('span', { key: 'hint' }, 'Not tested yet.'),
        ]) : null,
        h('div', { className: 'dsh-milvus-row dsh-milvus-actions', key: 'actions' }, [
          h('button', { type: 'button', disabled: state.pending || (!selected && draft.kind === 'zilliz-cloud' && !token), onClick: async () => {
            if (!selected && draft.kind === 'zilliz-cloud') {
              if (!await controller.writeCredential(draft, token)) return
              setToken('')
            }
            const saved = await controller.saveProfile(draft, selectedId || undefined)
            if (saved) choose(saved.id, saved)
          }, key: 'save' }, selected ? 'Save changes' : 'Create profile'),
          selected ? h('button', { type: 'button', disabled: state.pending || state.activeProfileId === selectedId, onClick: () => controller.selectProfile(selectedId), key: 'activate' }, state.activeProfileId === selectedId ? 'Active profile' : 'Use for new sessions') : null,
          selected ? h('button', { type: 'button', disabled: state.pending, onClick: async () => { await controller.removeProfile(selectedId); choose('') }, key: 'remove' }, 'Remove profile') : null,
        ]),
      ])
    }

    function installStyles(ctx) {
      if (typeof document === 'undefined') return
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-milvus'
        tag.textContent = '.dsh-milvus-card{list-style:none;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:8px;padding:16px}.dsh-milvus-card h3{margin:0}.dsh-milvus-intro,.dsh-milvus-hint{color:var(--dsw-alias-label-tertiary,#666);font-size:12px}.dsh-milvus-field{display:flex;flex-direction:column;gap:5px;margin-top:12px}.dsh-milvus-label{font-size:13px;font-weight:600}.dsh-milvus-field input,.dsh-milvus-field select{box-sizing:border-box;width:100%;padding:7px;border:1px solid var(--dsw-alias-border-l2,#aaa);border-radius:5px;background:transparent;color:inherit}.dsh-milvus-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px}.dsh-milvus-row{display:flex;gap:8px;align-items:center}.dsh-milvus-row input{flex:1}.dsh-milvus-actions{margin-top:16px}.dsh-milvus-row button,.dsh-milvus-check button{padding:7px 10px}.dsh-milvus-check{display:flex;gap:8px;align-items:center;margin-top:12px;font-size:12px}.dsh-milvus-error{color:#b42318;font-size:13px}@media(max-width:600px){.dsh-milvus-grid{grid-template-columns:1fr}}'
        document.head.appendChild(tag)
        return () => tag.remove()
      }, 'dsh-milvus: settings card styles')
    }

    return {
      name: 'dsh-milvus',
      inject: ['slots', 'connection', 'remote', 'settingsScope'],
      apply(ctx) {
        const controller = new MilvusProfileController(
          ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE }),
          ctx.settingsScope.bind({ namespace: STATUS_NAMESPACE }),
          ctx.get('connection').api,
        )
        installStyles(ctx)
        ctx.effect(() => ctx.remote.$on('credentials/updated', (ref) => controller.refreshCredential(ref)), 'dsh-milvus: credential status refresh')
        ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
          name: 'settings.plugin.item', id: 'dsh-milvus', key: 'dsh-milvus', inject: () => ({ controller }),
        }, MilvusSettingsCard))
      },
    }
  },
})
