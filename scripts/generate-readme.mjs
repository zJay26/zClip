import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

function renderTemplate(template, variables) {
  return template.replace(/\{\{(VERSION|TAG|SETUP_EXE)\}\}/g, (_, key) => {
    return variables[key]
  })
}

async function generateReadmes() {
  const pkgPath = path.join(rootDir, 'package.json')
  const pkg = await readJson(pkgPath)

  if (!pkg.version || typeof pkg.version !== 'string') {
    throw new Error('package.json version is missing or invalid')
  }

  const version = pkg.version.trim()
  const vars = {
    VERSION: version,
    TAG: `v${version}`,
    SETUP_EXE: `zClip.Setup.${version}.exe`
  }

  const jobs = [
    {
      template: path.join(rootDir, 'docs', 'templates', 'README.en.tpl.md'),
      output: path.join(rootDir, 'README.md')
    },
    {
      template: path.join(rootDir, 'docs', 'templates', 'README.zh.tpl.md'),
      output: path.join(rootDir, 'README.zh.md')
    }
  ]

  for (const job of jobs) {
    const templateContent = await readFile(job.template, 'utf8')
    const rendered = renderTemplate(templateContent, vars)
    await writeFile(job.output, rendered, 'utf8')
    console.log(`Generated: ${path.basename(job.output)}`)
  }
}

generateReadmes().catch((error) => {
  console.error(error)
  process.exit(1)
})
