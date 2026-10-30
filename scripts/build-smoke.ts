import { promises as fs } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { Builds } from '../src/main/builds'
import { Toolchains } from '../src/main/toolchains'

// Deliberately opt-in: this verifies real official tool downloads and two actual
// Minecraft plugin builds. Normal unit/Electron tests use local fixtures only.
async function main() {
  const root = path.resolve('.test-data/build-smoke')
  const toolsRoot = path.join(root, 'tools')
  await fs.mkdir(root, { recursive: true })
  const source = 'package dev.koda.smoke; import org.bukkit.plugin.java.JavaPlugin; public final class SmokePlugin extends JavaPlugin { @Override public void onEnable() { getLogger().info("Koda build smoke test"); } }'
  const metadata = "name: KodaBuildSmoke\nversion: 1.0.0\nmain: dev.koda.smoke.SmokePlugin\napi-version: '1.21'\n"
  let last = ''
  const cases = process.argv.includes('--legacy-only') ? [{ system: 'gradle' as const, java: 8, name: 'gradle-java8' }] : [{ system: 'maven' as const, java: 21, name: 'maven' }, { system: 'gradle' as const, java: 21, name: 'gradle' }]
  for (const build of cases) {
    const { system } = build
    const tools = new Toolchains(toolsRoot, { environment: build.java === 8 ? process.env : {} })
    const builds = new Builds(toolsRoot, tools)
    const project = path.join(root, build.name)
    await fs.mkdir(path.join(project, 'src/main/java/dev/koda/smoke'), { recursive: true })
    await fs.mkdir(path.join(project, 'src/main/resources'), { recursive: true })
    await fs.writeFile(path.join(project, 'src/main/java/dev/koda/smoke/SmokePlugin.java'), source)
    await fs.writeFile(path.join(project, 'src/main/resources/plugin.yml'), build.java === 8 ? metadata.replace("api-version: '1.21'\n", '') : metadata)
    if (system === 'maven') await fs.writeFile(path.join(project, 'pom.xml'), `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>dev.koda.smoke</groupId><artifactId>KodaMavenSmoke</artifactId><version>1.0.0</version><properties><maven.compiler.release>21</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties><repositories><repository><id>spigot</id><url>https://hub.spigotmc.org/nexus/content/repositories/snapshots/</url></repository></repositories><dependencies><dependency><groupId>org.spigotmc</groupId><artifactId>spigot-api</artifactId><version>1.21.1-R0.1-SNAPSHOT</version><scope>provided</scope></dependency></dependencies><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version></plugin></plugins></build></project>`)
    else {
      await fs.writeFile(path.join(project, 'settings.gradle.kts'), 'rootProject.name = "KodaGradleSmoke"')
      await fs.writeFile(path.join(project, 'build.gradle.kts'), `plugins { java }\nversion = "1.0.0"\nrepositories { mavenCentral(); maven("https://hub.spigotmc.org/nexus/content/repositories/snapshots/") }\ndependencies { compileOnly("org.spigotmc:spigot-api:${build.java === 8 ? '1.8.8' : '1.21.1'}-R0.1-SNAPSHOT")${build.java === 8 ? ' { isTransitive = false }' : ''} }\njava { toolchain { languageVersion.set(JavaLanguageVersion.of(${build.java})) } }`)
      if (build.java === 8) {
        await fs.mkdir(path.join(project, 'gradle/wrapper'), { recursive: true })
        await fs.writeFile(path.join(project, 'gradle/wrapper/gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.8.2-bin.zip')
      }
    }
    console.log(`REAL BUILD: ${build.name}`)
    const plan = await builds.inspect(project)
    const result = await builds.run(project, plan, new AbortController().signal, value => {
      const added = value.startsWith(last) ? value.slice(last.length) : value
      if (added.trim()) process.stdout.write(added)
      last = value
    })
    assert.ok(result.artifacts.some(artifact => artifact.kind === 'plugin'))
    console.log('\nVERIFIED:', JSON.stringify({ system, javaVersion: plan.javaVersion, artifacts: result.artifacts, tools: toolsRoot }))
    last = ''
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
