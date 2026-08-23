import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowUrl = new URL('../.github/workflows/publish.yml', import.meta.url)

test('the npm publishing workflow is bound to the reviewed OIDC release path', async () => {
  const [workflow, manifestSource] = await Promise.all([
    readFile(workflowUrl, 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ])
  const manifest = JSON.parse(manifestSource)

  assert.equal(manifest.repository?.url, 'git+https://github.com/zilliztech/dsh-milvus.git')
  assert.match(workflow, /^\s*push:\s*$/m)
  assert.match(workflow, /^\s*- master\s*$/m)
  assert.match(workflow, /^\s*- package\.json\s*$/m)
  assert.match(workflow, /^\s*- package-lock\.json\s*$/m)
  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m)
  assert.match(workflow, /^\s*contents: read\s*$/m)
  assert.match(workflow, /^\s*id-token: write\s*$/m)
  assert.match(workflow, /^\s*runs-on: ubuntu-latest\s*$/m)
  assert.match(workflow, /uses: actions\/checkout@v6/)
  assert.match(workflow, /uses: actions\/setup-node@v6/)
  assert.match(workflow, /^\s*node-version: '24'\s*$/m)
  assert.match(workflow, /npm install --global npm@11/)
  assert.match(workflow, /^\s*run: npm ci\s*$/m)
  assert.match(workflow, /^\s*run: npm test\s*$/m)
  assert.match(workflow, /npm view "\$\{package_spec\}" version/)
  assert.match(workflow, /^\s*run: npm publish --access public\s*$/m)
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|_authToken|secrets\./)
})
