import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { allLiterals, parseSource, sourceFilesUnder } from './renderedStrings'

/**
 * T-124 (28), hardened by T-125 (26), rebuilt where it overclaimed by T-126 (1), closed at its last gaps by T-127 (5), (6), (12), (13),
 * (14): every place the app's own code can reach the network, held against a list a person wrote down.
 *
 * CLAUDE.md says "no network calls, no telemetry, no analytics, no phone-home. A single one is a bug". Until this file that was
 * held by reviewers noticing, and a sweep is a person reading a diff. This reads the syntax tree of every non-test file under
 * `src/` and records each OUTBOUND site. A new one anywhere else is a failing test, whoever wrote it and however it got there.
 * To add one on purpose is to add a line to ALLOWED below, with the reason, in the commit that makes the call.
 *
 * WHAT IT SEES. Every shape named here has a branch in `outboundSites` and a case in the second describe block that proves it is
 * seen, and (for the narrow ones) a case that proves it is not over-seen. Each of those negatives was proven to discriminate
 * (round-21 protocol): the branch it protects was broken, the named case failed, the file was restored byte for byte.
 *   - calls: `fetch` (`net.fetch` and `window.fetch` too); `net.request`, matched on its LAST TWO segments (`electron.net.request(`,
 *     and an alias of the import, `import { net as enet }`, is resolved: `enet.request(`); `http.request`, `http.get`, `https.request`,
 *     `https.get`; `sendBeacon`; `shell.openExternal`; `window.open`; `loadURL`; `downloadURL`; `crashReporter.start`; the updater's
 *     `setFeedURL` / `checkForUpdates`; and a NAVIGATION of the page itself: `location.assign(`, `location.replace(`, a write to
 *     `location` or to its `href` / `host` / `hostname` / `protocol`, through any chain of `window.` `document.` `self.` `top.`
 *     `parent.` `globalThis.` (`window.top.location.href = u`). A write to `.hash`, `.pathname` or `.search` stays in the app's own
 *     page (ErrorBoundary's `window.location.hash = '#/home'`) and is not one;
 *   - `setAttribute('src' | 'href', ...)`, the way a page points an element it already has at an address;
 *   - a library handed a URL to load: `useImage(` (use-image, the image layer's `src`), `WaveSurfer.create(` (wavesurfer fetches its
 *     `url`), `Image.fromURL(`. These surfaces are ALIASABLE (`import useImg from 'use-image'`), so the IMPORT of `use-image` and
 *     `wavesurfer.js` is a site as well, and the call is judged through the alias;
 *   - modules, by `import`, `require`, a dynamic `import('...')`, an `export ... from '...'` (`export * from 'node:https'`) or TypeScript's
 *     `import x = require('...')`: Node's `http`/`https`/`net`/`tls`/`dgram`/..., an HTTP client, `electron-updater`, an analytics or
 *     crash SDK (`@sentry/*`, ...), `use-image`, `wavesurfer.js` and `child_process` (also aliasable: `import { spawn as run }`). A
 *     type-only import or export (`import type { ChildProcess }`, `export type { X } from`) loads nothing and is not a site.
 *     A dynamic `import(expr)` or `require(expr)` whose module is computed is itself a site, and so is `eval(` (also `window.eval(`),
 *     `new Function(` and the two ways to a module with no import in sight: `process.getBuiltinModule(` and `createRequire(` (T-127 (6));
 *   - Electron's `net`, `autoUpdater` and `crashReporter`, by NAME: imported from `electron` (aliased or not), destructured from
 *     `require('electron')`, or read off it (`electron.net`, `.autoUpdater`, `.crashReporter`);
 *   - a child process spawned with a command that is spelled `curl`, `wget`, `powershell`, ... or is not one of imagii's three
 *     binaries (`ffmpegPath`, `ffprobePath`, the whisper exe): a new `spawn(` of anything else is a site, also through an alias;
 *   - constructors: `XMLHttpRequest`, `WebSocket`, `EventSource`, `Image`, `Audio`, `RTCPeerConnection`, bare or through a global
 *     (`new window.WebSocket(u)`, `new globalThis.XMLHttpRequest()`, `new self.Image()`; T-127 (5)). Any other qualifier is a different
 *     constructor that shares a name (`new Konva.Image(`) and stays unmatched on purpose;
 *   - elements the page loads from a server: `<img>`, `<iframe>`, `<embed>`, `<object>`, `<script>`, `<link>`, `<source>`,
 *     `<track>`, `<video>`, `<audio>`, the SVG loaders `<image>`, `<use>`, `<feImage>`, and `<input type="image">` (JSX), and
 *     `document.createElement` of any of those tags or of `a` (`a.href = u; a.click()` navigates or downloads, and the property
 *     write is one this scan cannot see);
 *   - a CSS `url(` or `image-set(` whose address is computed in a template (`` `url(${src})` ``, `` `image-set("${src}" 1x)` ``): a
 *     style set from JS is not in any `.css` file, so the style-sheet scan below cannot see it;
 *   - every `http(s)://`, `ws(s)://`, `ftp(s)://host` literal, in code or JSX text, a bracketed IPv6 host (`http://[::1]:8080/`) too.
 * The page's CSP, its HTML and its style sheets are checked separately (the last tests of the first block). The CSP is judged by what
 * is LOCAL: a source passes only if it is a quoted keyword (`'self'`, `'none'`, `'unsafe-inline'`, a nonce, a hash) or one of the
 * schemes `data:` `blob:` `imagii-file:` `filesystem:`; a scheme-led address, a bare host, `host:port`, an IP, `localhost:*` or a
 * wildcard is remote, in any letter case, in EVERY directive. The style sheets may load no remote `url(` or `image-set(` and no
 * `@import`. `package.json` `dependencies` AND `devDependencies` (Vite bundles from either) are asserted to hold no updater,
 * telemetry or crash SDK, and `electron-builder.yml` no `publish`. The scan itself reads `.ts` and `.tsx` to a depth of eight
 * (`sourceFilesUnder`), so a test fails if a `.js`, `.jsx`, `.mjs` or `.cjs` file, or anything deeper, ever appears under `src/`.
 *
 * WHAT IT CANNOT SEE (so it does not claim it):
 *   - the PLATFORM'S OWN traffic: Chromium and Electron make requests the app's code never writes. The first one found was Electron's
 *     spellchecker downloading its dictionary from Google on every launch, and Chromium probing `dns.google` when the machine's DNS is
 *     a DNS-over-HTTPS provider (T-127 (1)); no source scan can see either. They are held by what the network stack ACTUALLY did:
 *     `smoke.spec.ts` launches the BUILT app with a net-log, idles past ready and fails on any http(s) or ws request it began or any
 *     host the resolver was asked for beyond this machine, with a loopback request as the control that the log can see at all;
 *   - a URL assembled at run time from parts that are not a literal (it sees the call, not the address, and every call it sees is on
 *     the list with a reason), a CSS `url(` assembled by concatenation (`'url(' + src + ')'`, only a template is read);
 *   - `fetch` used as a VALUE and not called where it is named: `const f = fetch`, `urls.map(fetch)`, `window['fetch'](u)`,
 *     `fetch.bind(window)(u)`. Following a value is beyond an AST scan; the day such a use is written, the `fetch` in the file that
 *     aliases it is the only thing on this list to look for;
 *   - a property write that points an element at an address (`img.src = u`): the element is a site where it is made (`<img>`,
 *     `new Image(`, `createElement`), `createElementNS` is not read, and `setAttribute` is read only for `src` and `href`;
 *   - an alias made by DESTRUCTURING a `require` (`const { spawn: run } = require('child_process')`): the require is the site;
 *   - a library that fetches on its own for a reason we did not name (only the entry points above are named);
 *   - the sidecar programs themselves (ffmpeg, ffprobe, whisper.cpp are handed local paths by the code the scan reads, and what a
 *     binary does inside is not source we can parse); native modules; and anything in a `node_modules` package. The CSS that
 *     `main.tsx` imports from a package (the bundled Inter font) is not under `src/`: the built output is checked by the Playwright
 *     run (`smoke.spec.ts`, T-126 (18)). The privacy review agent and the owner's release hand-check cover the rest.
 *
 * The THREE destinations the product has, all of them something the person asked for:
 *   - duckduckgo.com: Reference Search (a typed query, from the Reference Search panel).
 *   - huggingface.co: the caption model, downloaded once when the person presses Download in the Captions setup, plus a link. The
 *     download follows the server's 302 to Hugging Face's own CDN (`net.request` follows redirects), a second host no line of this
 *     tree names; it is the same destination.
 *   - github.com: a link in the Captions setup that opens the whisper.cpp releases page in the person's own browser.
 * The thumbnails Reference Search shows are fetched by the page (`<img>`) from the hosts the search returned, which is why the
 * page's `img-src` allows `https:` and nothing else does; the mood board's own copy of a thumbnail is fetched by main.
 *
 * Two shipped facts are NOT clean and are named, not hidden, in the places that hold them (ledger letters in docs/TICKETS.md):
 *   - (g) an image layer's `src` is not validated, so `useImage(layer.src)` under `img-src https:` can be pointed at any host by a
 *     shared project file: the `useImage(` line in ALLOWED is that known, owner-pending exposure and not an approval of it;
 *   - (m) the production CSP carries `connect-src ws:` (a dev-server leftover): `KNOWN_CSP_EXCEPTIONS` is that one token.
 */
const SRC = path.resolve(__dirname, '../../src')

/** Modules that are a way out: any import or require of one is a site. (Electron's own `net` is called `net.fetch`/`net.request`.) */
const NETWORK_MODULES = new Set([
  'http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'ws', 'undici', 'axios', 'node-fetch', 'got', 'superagent', 'socket.io-client',
  // T-125 (26): HTTP clients that were not named, the updater, and the analytics / crash SDKs (a scoped package is its scope).
  'cross-fetch', 'isomorphic-fetch', 'ky', 'needle', 'request',
  'electron-updater', 'update-electron-app',
  '@sentry', '@bugsnag', '@datadog', '@amplitude', '@segment', '@opentelemetry',
  'posthog-js', 'posthog-node', 'mixpanel', 'mixpanel-browser', 'amplitude-js', 'rollbar', 'logrocket', 'firebase', 'applicationinsights',
  // T-126 (1): the surfaces a call can be hidden behind an alias of (`import useImg from 'use-image'`, `import { spawn as run }`): the
  // IMPORT is the site, so renaming what it brings in cannot take the file off the list.
  'use-image', 'wavesurfer.js', 'child_process'
])
/** Constructors that open a connection or load a resource. */
const NETWORK_CONSTRUCTORS = new Set(['XMLHttpRequest', 'WebSocket', 'EventSource', 'Image', 'Audio', 'RTCPeerConnection'])
/** JSX elements whose attribute the page loads from a server (T-125 (26): and the two media elements; T-126 (1): and SVG's three). */
const LOADING_TAGS = new Set(['img', 'iframe', 'embed', 'object', 'script', 'link', 'source', 'track', 'video', 'audio', 'image', 'use', 'feImage'])
/**
 * T-127 (13): what `document.createElement` can make that does the same: every loading tag (lower case, as the DOM reads it) and `a`,
 * whose `href` plus `.click()` navigates the window or starts a download to any address (and whose property write the scan cannot see).
 */
const CREATED_ELEMENTS = new Set([...[...LOADING_TAGS].map((t) => t.toLowerCase()), 'a'])
/** T-127 (5): the global objects a constructor can be reached through (`new window.WebSocket(u)`); any other qualifier is not one. */
const GLOBAL_QUALIFIER = /^(?:window|globalThis|self)$/
/** T-125 (26): what Electron calls its updater and its crash uploader; seen when imported from, destructured from, or read off, anything. */
const ELECTRON_PHONE_HOMES = new Set(['autoUpdater', 'crashReporter'])
/** T-126 (1): and its network client. `net` is an ordinary word (`const { net } = totals`), so it counts only when it comes from `electron`. */
const ELECTRON_NET = 'net'
/** Programs that fetch from a server when run, whatever their arguments. */
const FETCHING_COMMANDS = new Set(['curl', 'wget', 'powershell', 'pwsh', 'bitsadmin', 'certutil', 'nc', 'ncat', 'ssh', 'scp', 'ftp', 'sftp'])
/** The only commands imagii spawns, as the code spells them: its own ffmpeg and ffprobe paths and the whisper.cpp exe. */
const OWN_BINARIES = new Set(['ffmpegPath', 'ffprobePath', 'status.exePath'])
/** Calls that start a child process. */
const SPAWN_CALLS = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'])
/** The names `child_process` is imported as (a bare `exec` is only a spawn when it is not `regex.exec`). */
const CHILD_PROCESS_OBJECTS = new Set(['child_process', 'cp', 'childProcess'])
/**
 * T-126 (1): `location` as the page spells it; a write to one of its `NAVIGATING_PROPS` (or to `location` itself) leaves the page.
 * T-127 (13): through any chain of the global qualifiers (`window.top.location.href`, `window.parent.location.assign(`).
 */
const LOCATION_TEXT = /^(?:(?:window|document|self|top|parent|globalThis)\.)*location$/
const NAVIGATING_PROPS = new Set(['href', 'host', 'hostname', 'protocol'])
/** The `setAttribute` names that point an element at an address. */
const ADDRESS_ATTRIBUTES = new Set(['src', 'href'])

/** An XML namespace is an identifier, never fetched. */
const NAMESPACE_HOSTS = new Set(['www.w3.org'])

// T-126 (1): in any letter case (`HTTPS://X.test` is the same address), and the host is recorded in lower case.
// T-127 (13): and a bracketed IPv6 literal is a host (`http://[::1]:8080/x`), recorded with its brackets.
const URL_LITERAL = /\b(?:https?|wss?|ftps?):\/\/(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9][A-Za-z0-9.-]*)/gi

const moduleName = (spec: string): string => spec.replace(/^node:/, '').split('/')[0] as string

/** `import type X from`, or an import whose every name is `type`d: it is erased at build and loads nothing. */
function isTypeOnlyImport(decl: ts.ImportDeclaration): boolean {
  const clause = decl.importClause
  if (!clause) return false
  if (clause.isTypeOnly) return true
  if (clause.name) return false
  const bindings = clause.namedBindings
  return !!bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly)
}

/** `export type { X } from 'm'`, or an export whose every name is `type`d: erased at build, loads nothing. */
function isTypeOnlyExport(decl: ts.ExportDeclaration): boolean {
  if (decl.isTypeOnly) return true
  const clause = decl.exportClause
  return !!clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly)
}

/** Is `init` Electron itself: `require('electron')` or a binding called `electron`? */
const isElectron = (init: ts.Expression | undefined, sf: ts.SourceFile): boolean =>
  !!init && /^(?:require\(\s*['"]electron['"]\s*\)|electron)$/.test(init.getText(sf))

/**
 * The name a `new` expression constructs, when that is a constructor the scan names (T-127 (5)): a bare `WebSocket`, or one reached through
 * a global (`window.WebSocket`, `globalThis.XMLHttpRequest`, `self.Image`). Any other qualifier (`Konva.Image`, `this.Image`, `a.b.Image`)
 * is a different constructor with the same last name, and stays unmatched on purpose.
 */
function constructorName(expr: ts.Expression, sf: ts.SourceFile): string {
  if (ts.isIdentifier(expr)) return NETWORK_CONSTRUCTORS.has(expr.text) || expr.text === 'Function' ? expr.text : ''
  if (ts.isPropertyAccessExpression(expr) && GLOBAL_QUALIFIER.test(expr.expression.getText(sf))) {
    return NETWORK_CONSTRUCTORS.has(expr.name.text) || expr.name.text === 'Function' ? expr.name.text : ''
  }
  return ''
}

/** Every outbound site in `sf`, in source order, as short stable names ("fetch(", "host:duckduckgo.com"). */
export function outboundSites(sf: ts.SourceFile): string[] {
  const sites: string[] = []
  const note = (name: string): void => {
    sites.push(name)
  }
  const noteModule = (spec: string): void => {
    if (NETWORK_MODULES.has(moduleName(spec))) note(`import:${moduleName(spec)}`)
  }
  // T-126 (1): what each name this file imports is CALLED where it is used, for the surfaces that can be renamed on the way in:
  // `import { spawn as run } from 'node:child_process'` makes `run(...)` a spawn, `import useImg from 'use-image'` makes `useImg(...)` a
  // `useImage(`, `import { net as enet } from 'electron'` makes `enet.request(...)` a `net.request(`. The import itself is a site too.
  const aliases = new Map<string, string>()
  const childProcessObjects = new Set(CHILD_PROCESS_OBJECTS)
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) continue
    const spec = st.moduleSpecifier.text
    const module = moduleName(spec)
    const clause = st.importClause
    const named = clause.namedBindings
    if (module === 'child_process') {
      if (clause.name) childProcessObjects.add(clause.name.text)
      if (named && ts.isNamespaceImport(named)) childProcessObjects.add(named.name.text)
      if (named && ts.isNamedImports(named)) for (const e of named.elements) if (e.propertyName) aliases.set(e.name.text, e.propertyName.text)
    } else if (spec === 'use-image' && clause.name) {
      aliases.set(clause.name.text, 'useImage')
    } else if (spec === 'wavesurfer.js' && clause.name) {
      aliases.set(clause.name.text, 'WaveSurfer')
    } else if (module === 'electron' && named && ts.isNamedImports(named)) {
      for (const e of named.elements) if (e.propertyName) aliases.set(e.name.text, e.propertyName.text)
    }
  }
  /** `a.b.c` with its first segment replaced by what the file imported it as. */
  const resolve = (dotted: string): string => {
    const [head, ...rest] = dotted.split('.')
    return [aliases.get(head as string) ?? head, ...rest].join('.')
  }
  /** A program's bare name: the last path segment, without its extension (`C:\tools\Curl.exe` is "curl"). */
  const programOf = (path: string): string =>
    (path.trim().split(/[\\/]/).pop() ?? '').replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
  const noteSpawn = (call: ts.CallExpression, isCommandLine: boolean): void => {
    const arg = call.arguments[0]
    if (!arg) return
    if (ts.isStringLiteralLike(arg)) {
      // `exec` / `execSync` take a whole command line, whose program is its first word; the others take the program itself (and a
      // path with a space in it, `C:\Program Files\...\curl.exe`, is one program).
      const program = programOf(isCommandLine ? (arg.text.trim().split(/\s+/)[0] ?? '') : arg.text)
      note(FETCHING_COMMANDS.has(program) ? `spawn:${program}` : `spawn("${program}")`)
      return
    }
    const text = arg.getText(sf).replace(/\s+/g, ' ')
    if (!OWN_BINARIES.has(text)) note(`spawn(${text})`)
  }
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression
      const name = resolve(
        ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? `${callee.expression.getText(sf)}.${callee.name.text}`
            : ''
      )
      const last = name.split('.').pop()
      // T-126 (1): the LAST TWO segments, so `electron.net.request(` and the alias `enet.request(` are the same site as `net.request(`.
      const lastTwo = name.split('.').slice(-2).join('.')
      const owner = name.split('.').slice(0, -1).join('.')
      // The bare name a call is made by, aliases resolved (`run(` for `import { spawn as run }`); a property call is judged by its object.
      const bare = ts.isIdentifier(callee) ? name : ''
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        // T-125 (26): a dynamic `import('x')`. Its specifier is judged like an import's; a computed one is a site of its own.
        const arg = n.arguments[0]
        if (arg && ts.isStringLiteralLike(arg)) noteModule(arg.text)
        else note('import(dynamic)')
      } else if (last === 'fetch') note('fetch(')
      else if (lastTwo === 'net.request') note('net.request(')
      else if (/^(https?|http2)\.(request|get)$/.test(name)) note('http(s).request(')
      else if (last === 'sendBeacon') note('sendBeacon(')
      else if (last === 'openExternal') note('shell.openExternal(')
      else if (last === 'downloadURL') note('downloadURL(')
      else if (last === 'setFeedURL' || last === 'checkForUpdates' || last === 'checkForUpdatesAndNotify') note('updater(')
      else if (lastTwo === 'crashReporter.start') note('crashReporter.start(')
      else if (name === 'window.open') note('window.open(')
      else if (last === 'loadURL') note('loadURL(')
      else if ((last === 'assign' || last === 'replace') && LOCATION_TEXT.test(owner)) note(`location.${last}(`)
      else if (last === 'setAttribute') {
        const attr = n.arguments[0]
        if (attr && ts.isStringLiteralLike(attr) && ADDRESS_ATTRIBUTES.has(attr.text.toLowerCase())) note(`setAttribute(${attr.text.toLowerCase()})`)
      } else if (last === 'useImage') note('useImage(')
      else if (name === 'WaveSurfer.create') note('WaveSurfer.create(')
      else if (name.endsWith('Image.fromURL')) note('Image.fromURL(')
      else if (/^(?:(?:window|globalThis|self)\.)?eval$/.test(name)) note('eval(')
      // T-127 (6): a module reached without an import or a `require(`: Node's `process.getBuiltinModule('node:https')` and a `require` made by
      // `createRequire(import.meta.url)`. Like `eval(` they are sites whatever their arguments, because the module they load is not a literal
      // the scan can judge.
      else if (last === 'getBuiltinModule') note('getBuiltinModule(')
      else if (last === 'createRequire') note('createRequire(')
      else if (ts.isIdentifier(callee) && callee.text === 'require') {
        const arg = n.arguments[0]
        if (arg && ts.isStringLiteralLike(arg)) noteModule(arg.text)
        else note('require(dynamic)')
      } else if (SPAWN_CALLS.has(bare) || (ts.isPropertyAccessExpression(callee) && childProcessObjects.has(resolve(callee.expression.getText(sf))) && SPAWN_CALLS.has(last as string))) {
        noteSpawn(n, last === 'exec' || last === 'execSync')
      } else if (last === 'createElement') {
        const arg = n.arguments[0]
        if (arg && ts.isStringLiteralLike(arg) && CREATED_ELEMENTS.has(arg.text.toLowerCase())) note(`createElement(${arg.text.toLowerCase()})`)
      }
    } else if (ts.isNewExpression(n) && constructorName(n.expression, sf) !== '') {
      const ctor = constructorName(n.expression, sf)
      if (NETWORK_CONSTRUCTORS.has(ctor)) note(`new ${ctor}(`)
      else if (ctor === 'Function') note('new Function(')
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      // T-126 (1): a write that navigates the page. `location.hash = ...` and `.pathname` / `.search` stay inside it.
      const left = n.left
      if (LOCATION_TEXT.test(left.getText(sf))) note('location =')
      else if (ts.isPropertyAccessExpression(left) && NAVIGATING_PROPS.has(left.name.text) && LOCATION_TEXT.test(left.expression.getText(sf))) {
        note(`location.${left.name.text} =`)
      }
    } else if (ts.isTemplateExpression(n)) {
      // T-126 (1): a CSS `url(` whose address is a hole (`url(${src})`, `url("${src}")`). A `url(#mask-${id})` is a fragment of the page.
      // T-127 (13): and `image-set(` (and `-webkit-image-set(`), which takes a bare string as its address (`image-set("${src}" 1x)`).
      const pieces = [n.head.text, ...n.templateSpans.map((t) => t.literal.text)]
      for (const piece of pieces.slice(0, -1)) {
        const loader = /(url|image-set)\(\s*['"]?$/i.exec(piece)
        if (loader) note(`${(loader[1] as string).toLowerCase()}(\${})`)
      }
    } else if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!isTypeOnlyImport(n)) noteModule(n.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      // T-127 (6): `export * from 'node:https'` and `export { get } from 'node:https'` load the module like an import does.
      if (!isTypeOnlyExport(n)) noteModule(n.moduleSpecifier.text)
    } else if (ts.isExternalModuleReference(n) && ts.isStringLiteralLike(n.expression)) {
      // T-127 (6): TypeScript's `import https = require('node:https')`, whose `require` is not a call in the tree.
      noteModule(n.expression.text)
    } else if (ts.isImportSpecifier(n) && !n.isTypeOnly && ELECTRON_PHONE_HOMES.has((n.propertyName ?? n.name).text)) {
      note(`electron:${(n.propertyName ?? n.name).text}`)
    } else if (
      ts.isImportSpecifier(n) &&
      !n.isTypeOnly &&
      (n.propertyName ?? n.name).text === ELECTRON_NET &&
      ts.isStringLiteral(n.parent.parent.parent.moduleSpecifier) &&
      n.parent.parent.parent.moduleSpecifier.text === 'electron'
    ) {
      note('electron:net')
    } else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
      // `const { net, autoUpdater } = require('electron')`: the names by their property, whatever they are renamed to.
      const named = n.propertyName ?? n.name
      const prop = ts.isIdentifier(named) ? named.text : ''
      const init = ts.isVariableDeclaration(n.parent.parent) ? n.parent.parent.initializer : undefined
      if (ELECTRON_PHONE_HOMES.has(prop) || (prop === ELECTRON_NET && isElectron(init, sf))) note(`electron:${prop}`)
    } else if (ts.isPropertyAccessExpression(n) && ELECTRON_PHONE_HOMES.has(n.name.text)) {
      note(`electron:${n.name.text}`)
    } else if (ts.isPropertyAccessExpression(n) && n.name.text === ELECTRON_NET && isElectron(n.expression, sf)) {
      note('electron:net')
    } else if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf)
      if (LOADING_TAGS.has(tag)) note(`<${tag}>`)
      else if (tag === 'input') {
        // T-126 (1): `<input type="image">` is an image button: it loads its `src`.
        const type = n.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === 'type')
        const value = type?.initializer
        const text = value && ts.isStringLiteral(value) ? value.text : value && ts.isJsxExpression(value) && value.expression && ts.isStringLiteralLike(value.expression) ? value.expression.text : ''
        if (text.toLowerCase() === 'image') note('<input type=image>')
      }
    } else if (ts.isJsxText(n)) {
      for (const m of n.text.matchAll(URL_LITERAL)) if (!NAMESPACE_HOSTS.has((m[1] as string).toLowerCase())) note(`host:${(m[1] as string).toLowerCase()}`)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  // A literal anywhere (a constant, a template, a JSX attribute): the host it names. Comments are not in the tree.
  for (const lit of allLiterals(sf)) {
    for (const m of lit.text.matchAll(URL_LITERAL)) if (!NAMESPACE_HOSTS.has((m[1] as string).toLowerCase())) note(`host:${(m[1] as string).toLowerCase()}`)
  }
  return sites
}

/**
 * Every outbound site in the product, and why it is there. A file not named here has none. Keys are relative to `src/`.
 * The counts are exact: a second `fetch(` in a file that already has one is a new site.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  // T-126 (1): `child_process` is a site at its IMPORT, so renaming `spawn` on the way in cannot take a file off the list. These files
  // spawn imagii's own ffmpeg and ffprobe (`ffmpegPath`, `ffprobePath`: the call scan below judges every `spawn(` separately, and
  // lists any command that is not one of the three binaries); none of them spawns anything else, and none touches a network.
  'main/audio/extract.ts': ['import:child_process'],
  // T-129: the waveform's peaks job decodes the file's sound with imagii's ffmpeg into a pipe (`ffmpegPath`; no file, no network).
  'main/audio/peaks.ts': ['import:child_process'],
  'main/audio/probe.ts': ['import:child_process'],
  'main/audio/process.ts': ['import:child_process'],
  'main/ffmpeg/concat.ts': ['import:child_process'],
  'main/ffmpeg/convert.ts': ['import:child_process'],
  'main/ffmpeg/export.ts': ['import:child_process'],
  'main/ffmpeg/frame.ts': ['import:child_process'],
  'main/ffmpeg/gif.ts': ['import:child_process'],
  'main/ffmpeg/highlights.ts': ['import:child_process'],
  'main/ffmpeg/probe.ts': ['import:child_process'],
  'main/ffmpeg/reframe.ts': ['import:child_process'],
  // Reference Search: the page of the query (for its token) and the image list. Both are the person's typed search.
  // T-126 (1): and Electron's `net` is a site at its import (`electron:net`) as well as at each call.
  'main/search/duckduckgo.ts': ['electron:net', 'fetch(', 'fetch(', 'host:duckduckgo.com', 'host:duckduckgo.com'],
  // "Save to board": main keeps its own copy of the chosen result's thumbnail, so the board survives the source going away.
  'main/search/moodboard.ts': ['electron:net', 'fetch('],
  // The caption model, once, when the person presses Download in the Captions setup.
  // (and it spawns the whisper.cpp exe it downloaded, `status.exePath`, which the call scan knows by name.)
  'main/sidecars/whisperManager.ts': ['import:child_process', 'electron:net', 'net.request('],
  'shared/captions.ts': ['host:huggingface.co'],
  // Two links the person clicks in the Captions setup (the whisper.cpp releases page and the model's page).
  'renderer/src/modules/video-studio/CaptionsPanel.tsx': ['host:github.com', 'host:huggingface.co'],
  // The window's own page: the dev server under `electron-vite dev` (loopback, from an env var), and the guarded hand-off of a
  // clicked http(s) link to the person's own browser.
  'main/index.ts': ['shell.openExternal(', 'loadURL('],
  // Reference Search results and the mood board: thumbnails, drawn by the page from the host the search named (CSP img-src https:).
  'renderer/src/modules/references/ReferencePanel.tsx': ['<img>'],
  'renderer/src/modules/references/MoodBoardPanel.tsx': ['new Image(', '<img>'],
  // Local pictures (a capture's thumbnail as a data URL, an imported file as a data URL): `<img>` draws them, nothing is requested.
  // T-125 (26): and the two live-preview `<video>`s, which play the capture's own MediaStream (`srcObject`), never an address.
  'renderer/src/modules/record-studio/RecordStudio.tsx': ['<img>', '<video>', '<video>'],
  'renderer/src/modules/record-studio/compositor.ts': ['createElement(video)', 'createElement(video)'],
  'renderer/src/modules/image-studio/ThumbnailVariants.tsx': ['new Image(', '<img>'],
  'renderer/src/modules/image-studio/ImportPanel.tsx': ['new Image('],
  // T-125 (26): the Player's `<video src>` is the person's own file (an `imagii-file:` or `blob:` address; CSP `media-src` allows no
  // remote one), and the waveform's `WaveSurfer.create({ url })` is handed the same kind of address. T-129: with `peaks` it fetches
  // nothing and only gives the address to its media element (CSP `media-src`; `connect-src` allows `imagii-file:` and the `ws:` named
  // below, no `http(s)`, either way).
  'renderer/src/modules/video-studio/Player.tsx': ['<video>'],
  // T-126 (1): wavesurfer is imported twice (the library and its regions plugin); each import is a site.
  'renderer/src/modules/audio-studio/WaveformView.tsx': ['import:wavesurfer.js', 'import:wavesurfer.js', 'WaveSurfer.create('],
  // T-125 (26), ledger (g): the image layer's `src` goes to `useImage` unvalidated, and CSP `img-src https:` lets a shared project
  // file point it at any host (a GET that tells that host the streamer's IP). This line is the KNOWN, OWNER-PENDING exposure the
  // ticket ledger names - it is on the list so the scan sees the path, and it is not an approval: the owner decides between
  // rejecting a remote `src` in `validateProject` and keeping the reference layer whose thumbnail is a DuckDuckGo https address.
  'renderer/src/modules/image-studio/Canvas.tsx': ['import:use-image', 'useImage('],
  // T-125 (26): `smoke.ts` runs `-version` on exactly two programs (`runVersion(ffmpegPath)`, `runVersion(ffprobePath)`); the
  // command is a parameter there, which is why the scan names it. Every other `spawn(` in src is handed `ffmpegPath`,
  // `ffprobePath` or the whisper exe by name, and the scan does not list those.
  'main/ffmpeg/smoke.ts': ['import:child_process', 'spawn(bin)'],
  // T-125 (26): `eval('require')('electron')` is how `tempCleanup` reaches `app.getPath` without a top-level electron import (the
  // unit tests load the module in plain node). The string is a constant in the file; an `eval(` anywhere else is a new site.
  'main/tempCleanup.ts': ['eval(']
}

/**
 * T-126 (1): a CSP source is LOCAL or it is remote, and LOCAL is the short, closed list. T-125 (26) swapped a pattern that could never
 * match a bare `ws:` for `/^(https?:|wss?:|ftps?:|\*)/`, which is still a list of what someone thought of: it passes every source that
 * does not begin with a scheme (a bare host `cdn.test`, `host:port`, an IP, `localhost:5173`, a `*.cdn.test` wildcard) and every scheme
 * written in capitals (`HTTPS://x.test`, `WSS:`), all of which a browser reads as remote. So the question is inverted: a source passes
 * only if it is a quoted keyword (`'self'`, `'none'`, `'unsafe-inline'`, a nonce or a hash: they name no address) or a scheme whose
 * content is on this machine, and everything else is a finding. The quotes matter: an unquoted `self` is a HOST called self.
 */
const LOCAL_CSP_KEYWORD =
  /^'(?:self|none|unsafe-inline|unsafe-eval|wasm-unsafe-eval|strict-dynamic|unsafe-hashes|report-sample|nonce-[A-Za-z0-9+/_=-]+|sha(?:256|384|512)-[A-Za-z0-9+/_=-]+)'$/i
const LOCAL_CSP_SCHEME = /^(?:data|blob|imagii-file|filesystem):$/i
export const isLocalCspSource = (source: string): boolean => LOCAL_CSP_KEYWORD.test(source) || LOCAL_CSP_SCHEME.test(source)
/** Directives whose value is not a list of sources (a flag, a sandbox token, a trusted-types policy name). */
const NON_SOURCE_DIRECTIVES = new Set([
  'sandbox', 'upgrade-insecure-requests', 'block-all-mixed-content', 'require-trusted-types-for', 'trusted-types', 'plugin-types'
])

/**
 * The remote sources the SHIPPED policy is known to carry, by directive, each with the ledger letter that names it. A token here is a
 * fact about the product that is not clean, not an approval: remove the token from `index.html` and the test that holds this list
 * fails until the line is deleted from it, so the list cannot outlive the exposure.
 *   - (m) `connect-src ws:`: a dev-server (HMR) leftover in the production policy; "verify dev still works before removing".
 */
export const KNOWN_CSP_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = { 'connect-src': ['ws:'] }

export function cspDirectives(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const part of csp.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    // A directive's name is not case-sensitive; the first of a repeated name is the one the browser reads.
    if (name && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), sources)
  }
  return out
}

/**
 * Every directive's sources that are not local and not a named exception, by directive. `img-src` may carry exactly `https:` (Reference
 * Search thumbnails are drawn by the page from the host the search named) and nothing else remote. Letter case never rescues a source.
 */
export function remoteCspSources(csp: string, exceptions: Readonly<Record<string, readonly string[]>> = KNOWN_CSP_EXCEPTIONS): Record<string, string[]> {
  const found: Record<string, string[]> = {}
  for (const [name, sources] of cspDirectives(csp)) {
    if (NON_SOURCE_DIRECTIVES.has(name)) continue
    const allowed = (name === 'img-src' ? ['https:'] : (exceptions[name] ?? [])).map((a) => a.toLowerCase())
    const bad = sources.filter((v) => !isLocalCspSource(v) && !allowed.includes(v.toLowerCase()))
    if (bad.length > 0) found[name] = bad
  }
  return found
}

/**
 * T-126 (1): the HTML-level check gets the same inversion. Every `scheme://...` in the page in any letter case whose scheme is not the
 * app's own file protocol, and every protocol-relative address (`src="//cdn.test/x.js"`, which the old `(https?|wss?|ftps?)://` never saw).
 */
const LOCAL_URL_SCHEMES = new Set(['imagii-file'])
export function remoteAddressesIn(html: string): string[] {
  const found: string[] = []
  for (const m of html.matchAll(/\b([a-z][a-z0-9+.-]*):\/\/[^\s"'<>)]*/gi)) {
    if (!LOCAL_URL_SCHEMES.has((m[1] as string).toLowerCase())) found.push(m[0])
  }
  for (const m of html.matchAll(/\b(?:src|href|action|data|poster|srcset)\s*=\s*["']?\s*(\/\/[^\s"'<>]*)/gi)) found.push(m[1] as string)
  return found
}

/** Package names that are an updater, a telemetry or analytics SDK, or a crash reporter. */
const PHONE_HOME_PACKAGE =
  /updater|sentry|bugsnag|rollbar|posthog|mixpanel|amplitude|segment|analytics|telemetry|opentelemetry|datadog|newrelic|logrocket|fullstory|hotjar|firebase|insights|crashlytics|raygun|honeybadger|countly|matomo|plausible|umami/i

export const phoneHomePackages = (names: readonly string[]): string[] => names.filter((n) => PHONE_HOME_PACKAGE.test(n))

/**
 * T-127 (14): the updater / telemetry / crash packages in a package.json, read from BOTH sections. Vite bundles whatever the renderer
 * imports, from either one, and `devDependencies` is where the build tools live: an SDK in either can reach the shipped app.
 */
export const phoneHomeInPackage = (pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): string[] =>
  phoneHomePackages([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])

/** A `publish` key anywhere in an electron-builder config (that is the update feed: `provider`, `url`, a release channel). */
export const hasPublishKey = (yml: string): boolean => /^\s*publish\s*:/m.test(yml.replace(/^\s*#.*$/gm, ''))

/**
 * T-127 (13): the first remote address a style sheet loads, or null. `url(` and, beside it, `image-set(` (whose argument can be a bare
 * string: `image-set("https://x.test/a.png" 1x)`), with a scheme or a protocol-relative `//`. A relative or `data:` address is local.
 */
export const remoteCssLoad = (css: string): string | null =>
  /(?:url|image-set)\(\s*['"]?\s*(?:https?:|wss?:|ftps?:)?\/\/[^\s)'"]*/i.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))?.[0] ?? null

/**
 * T-127 (13): what the scan below CANNOT read. It parses `.ts` and `.tsx` to a depth of 8 (`sourceFilesUnder`): a `.js`, `.jsx`, `.mjs`
 * or `.cjs` file anywhere under `dir`, or any file below that depth, would hold a call nobody is looking at. Empty = the scan reads
 * everything that is code.
 */
export function unreadableSourceIn(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name)
      if (statSync(full).isDirectory()) walk(full, depth + 1)
      else if (/\.(?:jsx?|mjs|cjs)$/i.test(name) || (depth > 8 && /\.(?:tsx?|css|html)$/i.test(name))) out.push(path.relative(dir, full).split(path.sep).join('/'))
    }
  }
  walk(dir, 0)
  return out
}

/** Every `.css` file under `dir`. */
function styleSheetsUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...styleSheetsUnder(full))
    else if (name.endsWith('.css')) out.push(full)
  }
  return out
}

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join('/')

function scanTree(): Record<string, string[]> {
  const found: Record<string, string[]> = {}
  for (const file of sourceFilesUnder(SRC)) {
    const sites = outboundSites(parseSource(file))
    if (sites.length > 0) found[rel(file)] = sites
  }
  return found
}

const parse = (code: string): string[] => outboundSites(parseSource('probe.tsx', code))

describe('the product reaches the network only where ALLOWED says it does (T-124 (28))', () => {
  it('reads the tree it is meant to police (a scan over nothing proves nothing)', () => {
    const files = sourceFilesUnder(SRC).map(rel)
    expect(files.length).toBeGreaterThan(150)
    expect(files).toContain('main/search/duckduckgo.ts')
    expect(files).toContain('main/index.ts')
    expect(files).toContain('renderer/src/modules/references/ReferencePanel.tsx')
  })

  it('src/ holds no code the scan cannot read: no .js / .jsx / .mjs / .cjs file, and nothing deeper than the eight levels it walks (T-127 (13))', () => {
    expect(unreadableSourceIn(SRC), 'a file the scan would never parse').toEqual([])
  })

  it('every outbound site in src/ is on the list, and every line on the list is still there', () => {
    const found = scanTree()
    // Every file that differs, at once, so one failure names all of them: the file, what the scan found, what ALLOWED names.
    const differs: Record<string, { found: string[]; allowed: readonly string[] }> = {}
    for (const file of new Set([...Object.keys(found), ...Object.keys(ALLOWED)])) {
      const sites = found[file] ?? []
      const allowed = ALLOWED[file] ?? []
      if (JSON.stringify(sites) !== JSON.stringify(allowed)) differs[file] = { found: sites, allowed }
    }
    expect(differs, 'outbound sites that are not the ones ALLOWED names (a new network call needs a line in ALLOWED, with a reason)').toEqual({})
  })

  it('there are three destinations, and they are the three the product documents', () => {
    const hosts = new Set(
      Object.values(scanTree())
        .flat()
        .filter((s) => s.startsWith('host:'))
        .map((s) => s.slice('host:'.length))
    )
    expect([...hosts].sort()).toEqual(['duckduckgo.com', 'github.com', 'huggingface.co'])
  })

  it('the page itself may fetch nothing: no remote scheme in any directive but the named exceptions, and `https:` for images alone', () => {
    const html = readFileSync(path.join(SRC, 'renderer', 'index.html'), 'utf8')
    const csp = /Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1]
    expect(csp, 'index.html carries a Content-Security-Policy').toBeTruthy()
    const directives = cspDirectives(csp as string)
    expect(directives.get('default-src')).toEqual(["'self'"])
    expect(directives.get('script-src')).toEqual(["'self'"])
    // Every directive, not a list of four: a new `font-src https:` or `frame-src *` is caught the day it is written.
    expect(remoteCspSources(csp as string), 'a directive names somewhere other than the page itself').toEqual({})
    expect(directives.get('img-src')).toContain('https:')
    expect(directives.get('img-src')).not.toContain('http:')
    // (m): the named exception is still there. When it is removed from index.html this fails, and the line goes from the list.
    for (const [name, tokens] of Object.entries(KNOWN_CSP_EXCEPTIONS)) {
      for (const token of tokens) expect(directives.get(name), `${name} no longer carries ${token}: delete it from KNOWN_CSP_EXCEPTIONS`).toContain(token)
    }
    expect(remoteAddressesIn(html), 'the page names no remote address of its own').toEqual([])
  })

  it('the style sheets fetch nothing: no remote url() and no @import', () => {
    const sheets = styleSheetsUnder(SRC)
    expect(sheets.map(rel), 'the scan finds the app\'s style sheet').toContain('renderer/src/styles/index.css')
    for (const sheet of sheets) {
      const css = readFileSync(sheet, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(remoteCssLoad(css), `${rel(sheet)} loads a remote address`).toBeNull()
      expect(css, `${rel(sheet)} @imports a stylesheet`).not.toMatch(/@import\b/i)
    }
  })

  it('the package carries no updater, telemetry or crash SDK, and the build publishes no update feed', () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const dependencies = Object.keys(pkg.dependencies ?? {})
    expect(dependencies.length, 'the scan reads the real dependency list').toBeGreaterThan(10)
    expect(Object.keys(pkg.devDependencies ?? {}).length, 'and the real devDependencies (T-127 (14): vite bundles from either)').toBeGreaterThan(10)
    expect(phoneHomeInPackage(pkg), 'an updater / telemetry / crash SDK is a dependency, or a devDependency the build bundles').toEqual([])
    // The check can SEE a devDependency: the same package.json with one added.
    expect(phoneHomeInPackage({ ...pkg, devDependencies: { ...pkg.devDependencies, '@sentry/electron': '1.0.0' } })).toEqual(['@sentry/electron'])
    const builder = readFileSync(path.resolve(__dirname, '../../electron-builder.yml'), 'utf8')
    expect(builder, 'the build config is the one the release uses').toContain('appId: com.makenah.imagii')
    expect(hasPublishKey(builder), 'electron-builder.yml names a `publish` target: that is an update feed').toBe(false)
  })
})

describe('the scan finds what it is meant to find, and nothing it is not (T-124 (28))', () => {
  it('flags every way out it names', () => {
    expect(parse("fetch('https://tracker.test/p')")).toEqual(['fetch(', 'host:tracker.test'])
    expect(parse('await net.fetch(url)')).toEqual(['fetch('])
    expect(parse('window.fetch(url)')).toEqual(['fetch('])
    expect(parse('const r = net.request(u)')).toEqual(['net.request('])
    expect(parse("import https from 'node:https'")).toEqual(['import:https'])
    expect(parse("const net = require('net')")).toEqual(['import:net'])
    expect(parse("https.get('x')")).toEqual(['http(s).request('])
    expect(parse('new XMLHttpRequest()')).toEqual(['new XMLHttpRequest('])
    expect(parse("new WebSocket('wss://live.test/x')")).toEqual(['new WebSocket(', 'host:live.test'])
    expect(parse('new EventSource(u)')).toEqual(['new EventSource('])
    expect(parse('navigator.sendBeacon(u, d)')).toEqual(['sendBeacon('])
    expect(parse('shell.openExternal(u)')).toEqual(['shell.openExternal('])
    expect(parse('window.open(u)')).toEqual(['window.open('])
    expect(parse('win.loadURL(u)')).toEqual(['loadURL('])
    expect(parse('new Image()')).toEqual(['new Image('])
    expect(parse('const x = <img src={u} />')).toEqual(['<img>'])
    expect(parse('const x = <iframe src={u}></iframe>')).toEqual(['<iframe>'])
    expect(parse("document.createElement('script')")).toEqual(['createElement(script)'])
    expect(parse('const u = `https://a.test/${id}`')).toEqual(['host:a.test'])
    expect(parse('const x = <a href="https://b.test/p">go</a>')).toEqual(['host:b.test'])
    expect(parse('const x = <p>see https://c.test/docs</p>')).toEqual(['host:c.test'])
  })

  // T-125 (26): every shape added to the vocabulary is seen, by name, here - and each of these returned [] from the first scanner.
  it('flags the shapes round 75 added: a library handed a URL, a dynamic import, the updater, a download, a fetching program, media elements', () => {
    // The ledgered (g) path: use-image fetches whatever `src` it is given.
    expect(parse('const [img] = useImage(layer.src, "anonymous")')).toEqual(['useImage('])
    expect(parse('WaveSurfer.create({ url })')).toEqual(['WaveSurfer.create('])
    expect(parse('Konva.Image.fromURL(u, cb)')).toEqual(['Image.fromURL('])
    // A dynamic import: judged by its specifier when it is spelled, a site of its own when it is computed.
    expect(parse("const m = await import('undici')")).toEqual(['import:undici'])
    expect(parse("const m = await import('node:https')")).toEqual(['import:https'])
    expect(parse("const m = await import('node:fs/promises')")).toEqual([])
    expect(parse('const m = await import(name)')).toEqual(['import(dynamic)'])
    expect(parse('const m = require(name)')).toEqual(['require(dynamic)'])
    expect(parse("const m = require('./local')")).toEqual([])
    expect(parse("eval('require')('https')")).toEqual(['eval('])
    expect(parse('new Function("return fetch")')).toEqual(['new Function('])
    // The updater and the telemetry / crash SDKs, by module and by Electron's own names.
    expect(parse("import { autoUpdater } from 'electron-updater'")).toEqual(['import:electron-updater', 'electron:autoUpdater'])
    expect(parse("import * as Sentry from '@sentry/electron/main'")).toEqual(['import:@sentry'])
    expect(parse("const s = require('@sentry/node')")).toEqual(['import:@sentry'])
    expect(parse("import { autoUpdater, crashReporter } from 'electron'")).toEqual(['electron:autoUpdater', 'electron:crashReporter'])
    expect(parse('electron.autoUpdater.setFeedURL({ url })')).toEqual(['updater(', 'electron:autoUpdater'])
    expect(parse('autoUpdater.checkForUpdates()')).toEqual(['updater('])
    expect(parse("import posthog from 'posthog-js'")).toEqual(['import:posthog-js'])
    // A download handed to the browser's own downloader.
    expect(parse('win.webContents.downloadURL(u)')).toEqual(['downloadURL('])
    // A fetching program spawned by name; a spawn of anything that is not imagii's own binaries is a site too.
    expect(parse("spawn('curl', ['-O', u])")).toEqual(['spawn:curl'])
    expect(parse(String.raw`execFile('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-c', c])`)).toEqual(['spawn:powershell'])
    expect(parse(String.raw`spawn('C:\\Program Files\\curl\\curl.exe', ['-O', u])`)).toEqual(['spawn:curl'])
    expect(parse("child_process.exec('wget -q http://x.test/a')")).toEqual(['spawn:wget', 'host:x.test'])
    expect(parse("cp.spawnSync('pwsh', args)")).toEqual(['spawn:pwsh'])
    expect(parse('spawn(somethingElse, args)')).toEqual(['spawn(somethingElse)'])
    expect(parse("spawn('node', args)")).toEqual(['spawn("node")'])
    // The media elements: the page fetches whatever `src` they are given.
    expect(parse('const x = <video src={u} />')).toEqual(['<video>'])
    expect(parse('const x = <audio src={u}></audio>')).toEqual(['<audio>'])
    expect(parse("const v = document.createElement('video')")).toEqual(['createElement(video)'])
    expect(parse("const a = document.createElement('audio')")).toEqual(['createElement(audio)'])
    expect(parse('const a = new Audio(u)')).toEqual(['new Audio('])
  })

  it('does not flag a comment, a function that only has "fetch" in its name, a type, a namespace, or a bare scheme check', () => {
    expect(parse('// fetch("https://x.test")\n/* new WebSocket("wss://y.test") */ const a = 1')).toEqual([])
    expect(parse('await fetchText(url)')).toEqual([])
    expect(parse('type R = ReturnType<typeof net.request>')).toEqual([])
    expect(parse('const ns = "http://www.w3.org/2000/svg"')).toEqual([])
    expect(parse("if (u.startsWith('https://') || u.startsWith('http://')) go()")).toEqual([])
    expect(parse("import { shell } from 'electron'")).toEqual([])
  })

  // T-125 (26): and what the wider vocabulary must NOT catch, or every line of ALLOWED would be noise.
  it('does not flag the imagii spawns, a regex exec, a local import, or a string that merely says "video"', () => {
    expect(parse('const child = spawn(ffmpegPath, args, { windowsHide: true })')).toEqual([])
    expect(parse('const p = spawn(ffprobePath, args)')).toEqual([])
    expect(parse('const child = spawn(status.exePath, args)')).toEqual([])
    expect(parse('const m = re.exec(text)')).toEqual([])
    expect(parse('const m = SRT_TIME_LINE.exec(line)')).toEqual([])
    expect(parse("import { x } from './local'")).toEqual([])
    expect(parse("import { app } from 'electron'")).toEqual([])
    expect(parse("const label = 'video'")).toEqual([])
    expect(parse('const useImageCache = 1')).toEqual([])
    expect(parse('function useImages() {}')).toEqual([])
    expect(parse('const evaluate = (x) => x')).toEqual([])
  })

  // T-126 (1): the CSP check is a LOCAL allowlist. T-125 (26)'s `/^(https?:|wss?:|ftps?:|\*)/` passed every source that does not begin with
  // a scheme and every scheme in capitals; each of those is a case here, and so is each local form (the allowlist must not be so tight
  // that the shipped policy fails it).
  // T-126 (1): the shapes round 76 added. Each returned [] from the scanner before it.
  it('flags the page navigating itself, an element pointed at an address by setAttribute, the SVG and image-input loaders, and a computed CSS url(', () => {
    expect(parse("window.location.href = 'https://x.test/a'")).toEqual(['location.href =', 'host:x.test'])
    expect(parse('location.href = u')).toEqual(['location.href ='])
    expect(parse('document.location.href = u')).toEqual(['location.href ='])
    expect(parse('location.href += "#x"')).toEqual(['location.href ='])
    expect(parse('location.hostname = h')).toEqual(['location.hostname ='])
    expect(parse('location.host = h')).toEqual(['location.host ='])
    expect(parse('location.protocol = "http:"')).toEqual(['location.protocol ='])
    expect(parse('window.location = u')).toEqual(['location ='])
    expect(parse('document.location = u')).toEqual(['location ='])
    expect(parse('location = u')).toEqual(['location ='])
    expect(parse('location.assign(u)')).toEqual(['location.assign('])
    expect(parse('window.location.replace(u)')).toEqual(['location.replace('])
    expect(parse('document.location.assign(u)')).toEqual(['location.assign('])
    expect(parse("img.setAttribute('src', u)")).toEqual(['setAttribute(src)'])
    expect(parse("a.setAttribute('HREF', u)")).toEqual(['setAttribute(href)'])
    expect(parse('const x = <svg><image href={u} /></svg>')).toEqual(['<image>'])
    expect(parse('const x = <svg><use href="#a" /></svg>')).toEqual(['<use>'])
    expect(parse('const x = <svg><feImage href={u} /></svg>')).toEqual(['<feImage>'])
    expect(parse('const x = <input type="image" src={u} />')).toEqual(['<input type=image>'])
    expect(parse("const x = <input type={'image'} src={u} />")).toEqual(['<input type=image>'])
    expect(parse('const s = { backgroundImage: `url(${src})` }')).toEqual(['url(${})'])
    expect(parse('const s = `url("${src}")`')).toEqual(['url(${})'])
    expect(parse("const s = `url('${src}') no-repeat`")).toEqual(['url(${})'])
    expect(parse('const s = `x url( ${src})`')).toEqual(['url(${})'])
  })

  it('follows a name through the import that renamed it, flags the import itself (use-image, wavesurfer.js, child_process, Electron\'s net / autoUpdater / crashReporter), and sees crashReporter.start', () => {
    expect(parse("import useImg from 'use-image'\nconst [i] = useImg(u)")).toEqual(['import:use-image', 'useImage('])
    expect(parse("import Wave from 'wavesurfer.js'\nWave.create({ url })")).toEqual(['import:wavesurfer.js', 'WaveSurfer.create('])
    expect(parse("import Regions from 'wavesurfer.js/dist/plugins/regions.esm.js'")).toEqual(['import:wavesurfer.js'])
    expect(parse("import { spawn as run } from 'node:child_process'\nrun('curl', ['-O', u])")).toEqual(['import:child_process', 'spawn:curl'])
    expect(parse("import { spawn as run } from 'node:child_process'\nrun(ffmpegPath, args)")).toEqual(['import:child_process'])
    expect(parse("import { spawn, type ChildProcess } from 'node:child_process'")).toEqual(['import:child_process'])
    expect(parse("import * as proc from 'node:child_process'\nproc.execFile('powershell', a)")).toEqual(['import:child_process', 'spawn:powershell'])
    expect(parse("import { exec as sh } from 'child_process'\nsh('wget http://x.test/a')")).toEqual(['import:child_process', 'spawn:wget', 'host:x.test'])
    expect(parse("import { net as enet } from 'electron'\nenet.request(u)")).toEqual(['electron:net', 'net.request('])
    expect(parse("import { net } from 'electron'\nconst r = await net.fetch(u)")).toEqual(['electron:net', 'fetch('])
    expect(parse('electron.net.request(u)')).toEqual(['net.request(', 'electron:net'])
    expect(parse("require('electron').net.request(u)")).toEqual(['net.request(', 'electron:net'])
    expect(parse("const { net, app } = require('electron')")).toEqual(['electron:net'])
    expect(parse('const { net: enet } = electron')).toEqual(['electron:net'])
    expect(parse("const { autoUpdater } = require('electron')")).toEqual(['electron:autoUpdater'])
    expect(parse('const { crashReporter: cr } = anything')).toEqual(['electron:crashReporter'])
    expect(parse('crashReporter.start({ submitURL: u })')).toEqual(['crashReporter.start('])
    expect(parse("import { crashReporter as cr } from 'electron'\ncr.start({})")).toEqual(['electron:crashReporter', 'crashReporter.start('])
    expect(parse('electron.crashReporter.start({})')).toEqual(['crashReporter.start(', 'electron:crashReporter'])
  })

  // And what the round-76 vocabulary must NOT catch, or the new lines of ALLOWED would be noise. Each of these was proven to
  // discriminate by breaking the branch it protects (the mutation rows in the T-126 ledger).
  it('does not flag a write to .hash / .pathname / .search, a read or a reload, a string replace, a type-only import, a class setAttribute, a plain input, or a url(#fragment)', () => {
    // ErrorBoundary's own button: it moves within the page.
    expect(parse("window.location.hash = '#/home'")).toEqual([])
    expect(parse('location.pathname = p')).toEqual([])
    expect(parse('location.search = q')).toEqual([])
    expect(parse('const h = window.location.href')).toEqual([])
    expect(parse('window.location.reload()')).toEqual([])
    expect(parse("const t = name.replace('a', 'b')")).toEqual([])
    expect(parse('Object.assign(target, source)')).toEqual([])
    expect(parse('props.location = here')).toEqual([])
    expect(parse("el.setAttribute('class', 'x')")).toEqual([])
    expect(parse("el.setAttribute('aria-label', u)")).toEqual([])
    expect(parse('const x = <input type="text" />')).toEqual([])
    expect(parse('const x = <input />')).toEqual([])
    expect(parse('const s = `translate(${x}px, ${y}px)`')).toEqual([])
    expect(parse('const s = `url(#mask-${id})`')).toEqual([])
    expect(parse("import type { ChildProcess } from 'node:child_process'")).toEqual([])
    expect(parse("import { type ChildProcess } from 'node:child_process'")).toEqual([])
  })

  it('does not follow a name that was not imported from the surface it looks like', () => {
    expect(parse("function run(cmd) {}\nrun('curl')")).toEqual([])
    expect(parse("import { run } from './runner'\nrun('curl')")).toEqual([])
    expect(parse("import { spawn as run } from './local'\nrun('curl')")).toEqual([])
    expect(parse("import { net as enet } from './local'\nenet.request(u)")).toEqual([])
    expect(parse("import { net } from './net'")).toEqual([])
    expect(parse('const { net } = totals')).toEqual([])
    expect(parse('const { net, gross } = invoice')).toEqual([])
    expect(parse('timer.start()')).toEqual([])
    expect(parse('myCrashReporter.start()')).toEqual([])
    expect(parse("import useThing from './use-image'\nuseThing(u)")).toEqual([])
  })

  // T-126 (1), (v): the header lists these, so each is a case. (The first scanner's cases covered a few of each list and the header named all.)
  it('sees every element, constructor and scheme the header names: each loading tag, each createElement, each constructor, an address in any letter case', () => {
    for (const tag of ['img', 'iframe', 'embed', 'object', 'script', 'link', 'source', 'track', 'video', 'audio', 'image', 'use', 'feImage']) {
      expect(parse(`const x = <${tag} src={u} />`), `<${tag}>`).toEqual([`<${tag}>`])
    }
    // T-127 (13): every loading tag, and `a`.
    for (const el of ['img', 'iframe', 'embed', 'object', 'script', 'link', 'source', 'track', 'video', 'audio', 'image', 'use', 'feimage', 'a']) {
      expect(parse(`document.createElement('${el}')`), `createElement('${el}')`).toEqual([`createElement(${el})`])
      expect(parse(`document.createElement('${el.toUpperCase()}')`), `createElement('${el.toUpperCase()}')`).toEqual([`createElement(${el})`])
    }
    expect(parse("document.createElement('feImage')"), 'the SVG tag as the DOM spells it').toEqual(['createElement(feimage)'])
    // ...and the elements the app makes that load nothing (the canvases, the file input) are not sites.
    for (const el of ['canvas', 'div', 'span', 'input', 'button', 'p']) {
      expect(parse(`document.createElement('${el}')`), `createElement('${el}')`).toEqual([])
    }
    for (const ctor of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'Image', 'Audio', 'RTCPeerConnection']) {
      expect(parse(`new ${ctor}()`), `new ${ctor}`).toEqual([`new ${ctor}(`])
    }
    expect(parse("const u = 'ftp://f.test/x'")).toEqual(['host:f.test'])
    expect(parse("const u = 'ftps://f.test/x'")).toEqual(['host:f.test'])
    expect(parse("const u = 'wss://live.test/x'")).toEqual(['host:live.test'])
    expect(parse("const u = 'HTTPS://Tracker.TEST/p'")).toEqual(['host:tracker.test'])
    expect(parse('const x = <p>see HTTP://C.test/docs</p>')).toEqual(['host:c.test'])
    expect(parse("const ns = 'HTTP://WWW.W3.ORG/2000/svg'")).toEqual([])
  })

  it('the CSP check passes only what is local - a quoted keyword, a nonce, a hash, data: blob: imagii-file: filesystem: - in any letter case', () => {
    const local = [
      "'self'", "'none'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "'strict-dynamic'", "'SELF'", "'nonce-AbC123+/=='",
      "'sha256-AbC123+/='", "'sha384-x'", "'sha512-x'", 'data:', 'blob:', 'imagii-file:', 'filesystem:', 'DATA:', 'Blob:', 'IMAGII-FILE:'
    ]
    for (const source of local) expect(isLocalCspSource(source), `${source} is local`).toBe(true)
    const remote = [
      'https:', 'http:', 'ws:', 'wss:', 'ftp:', '*', 'https://api.test', 'HTTPS://x.test', 'WSS:', 'Wss://live.test', 'cdn.test', 'CDN.TEST',
      'example.com:8080', 'localhost', 'localhost:5173', '127.0.0.1', '127.0.0.1:3000', '192.168.0.1', '[::1]', '*.cdn.test', 'https://*.cdn.test',
      // Unquoted, a keyword is a HOST of that name; an unknown or empty quoted one is not a keyword either.
      'self', 'none', 'unsafe-inline', "'selff'", "'unsafe-evall'", "'nonce-'", "'sha1-abc'", 'data', 'dataurl:', 'blob', 'file:', 'chrome-extension:', 'ssh:'
    ]
    for (const source of remote) expect(isLocalCspSource(source), `${source} is remote`).toBe(false)
    // The pattern this replaces called every one of these local.
    const T125 = /^(https?:|wss?:|ftps?:|\*)/
    for (const missed of ['cdn.test', 'example.com:8080', '192.168.0.1', 'localhost:5173', 'HTTPS://x.test', 'WSS:']) {
      expect(T125.test(missed), `T-125's pattern missed ${missed}`).toBe(false)
      expect(isLocalCspSource(missed), `${missed} is remote`).toBe(false)
    }
  })

  it('the CSP check judges every directive, honours only the named exception and `https:` for images, and reads names and schemes in any letter case', () => {
    const base = "default-src 'self'; script-src 'self'; img-src 'self' data: blob: https: imagii-file:; connect-src 'self' imagii-file:"
    expect(remoteCspSources(base)).toEqual({})
    // Bare `ws:` in connect-src is the named exception (m); anywhere else it is a finding, and so is every other remote scheme.
    expect(remoteCspSources("connect-src 'self' ws: imagii-file:")).toEqual({})
    expect(remoteCspSources("connect-src 'self' WS: imagii-file:")).toEqual({})
    expect(remoteCspSources("connect-src 'self' ws:", {})).toEqual({ 'connect-src': ['ws:'] })
    expect(remoteCspSources("media-src 'self' ws:")).toEqual({ 'media-src': ['ws:'] })
    expect(remoteCspSources("connect-src 'self' ws: wss://live.test")).toEqual({ 'connect-src': ['wss://live.test'] })
    expect(remoteCspSources("connect-src 'self' https:")).toEqual({ 'connect-src': ['https:'] })
    expect(remoteCspSources("connect-src 'self' ftp:")).toEqual({ 'connect-src': ['ftp:'] })
    expect(remoteCspSources("script-src 'self' https://cdn.test")).toEqual({ 'script-src': ['https://cdn.test'] })
    expect(remoteCspSources('default-src *')).toEqual({ 'default-src': ['*'] })
    // A directive nobody listed is still judged.
    expect(remoteCspSources("font-src 'self' https://fonts.test")).toEqual({ 'font-src': ['https://fonts.test'] })
    expect(remoteCspSources("frame-src *")).toEqual({ 'frame-src': ['*'] })
    // The forms a scheme-led pattern passes: a bare host, host:port, an IP, localhost, a wildcard host.
    expect(remoteCspSources("connect-src 'self' cdn.test")).toEqual({ 'connect-src': ['cdn.test'] })
    expect(remoteCspSources("connect-src 'self' example.com:8080")).toEqual({ 'connect-src': ['example.com:8080'] })
    expect(remoteCspSources("connect-src 'self' 192.168.0.5")).toEqual({ 'connect-src': ['192.168.0.5'] })
    expect(remoteCspSources("connect-src 'self' localhost:5173")).toEqual({ 'connect-src': ['localhost:5173'] })
    expect(remoteCspSources("script-src 'self' *.cdn.test")).toEqual({ 'script-src': ['*.cdn.test'] })
    // Letter case rescues nothing: the scheme, the host and the directive's own name.
    expect(remoteCspSources("script-src 'self' HTTPS://cdn.test")).toEqual({ 'script-src': ['HTTPS://cdn.test'] })
    expect(remoteCspSources("connect-src 'self' WSS:")).toEqual({ 'connect-src': ['WSS:'] })
    expect(remoteCspSources("Connect-Src 'self' https:")).toEqual({ 'connect-src': ['https:'] })
    // Images may carry `https:` and nothing else remote.
    expect(remoteCspSources("img-src 'self' https:")).toEqual({})
    expect(remoteCspSources("img-src 'self' HTTPS:")).toEqual({})
    expect(remoteCspSources("img-src 'self' http: https:")).toEqual({ 'img-src': ['http:'] })
    expect(remoteCspSources("img-src 'self' https://cdn.test")).toEqual({ 'img-src': ['https://cdn.test'] })
    expect(remoteCspSources("img-src 'self' cdn.test")).toEqual({ 'img-src': ['cdn.test'] })
    expect(remoteCspSources('img-src * ')).toEqual({ 'img-src': ['*'] })
    // A directive that is a flag or a token list has no sources to judge; the browser reads the first of a repeated directive.
    expect(remoteCspSources('upgrade-insecure-requests; sandbox allow-scripts; block-all-mixed-content')).toEqual({})
    expect(cspDirectives("script-src 'self'; script-src https://x.test").get('script-src')).toEqual(["'self'"])
  })

  it('the HTML check sees a remote address in any letter case and a protocol-relative one, and lets the app\'s own file protocol and its own paths through', () => {
    expect(remoteAddressesIn('<img src="HTTPS://x.test/a.png">')).toEqual(['HTTPS://x.test/a.png'])
    expect(remoteAddressesIn('<script src="wss://live.test"></script>')).toEqual(['wss://live.test'])
    expect(remoteAddressesIn('<script src="//cdn.test/x.js"></script>')).toEqual(['//cdn.test/x.js'])
    expect(remoteAddressesIn("<link rel=stylesheet href='//fonts.test/css'>")).toEqual(['//fonts.test/css'])
    expect(remoteAddressesIn('<img src = "ftp://f.test/a">')).toEqual(['ftp://f.test/a'])
    expect(remoteAddressesIn('<img src="imagii-file://C:/clip.png">')).toEqual([])
    expect(remoteAddressesIn('<script type="module" src="/src/main.tsx"></script>')).toEqual([])
    expect(remoteAddressesIn('<a href="#top">top</a>')).toEqual([])
    expect(remoteAddressesIn('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; img-src data: blob:">')).toEqual([])
  })

  // T-127 (5): each of these returned [] (the scan looked only at a bare identifier after `new`).
  it('sees a constructor reached through a global - window., globalThis., self. - for each constructor the scan names (T-127 (5))', () => {
    for (const qualifier of ['window', 'globalThis', 'self']) {
      for (const ctor of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'Image', 'Audio', 'RTCPeerConnection']) {
        expect(parse(`new ${qualifier}.${ctor}(u)`), `new ${qualifier}.${ctor}`).toEqual([`new ${ctor}(`])
      }
      expect(parse(`new ${qualifier}.Function('return 1')`), `new ${qualifier}.Function`).toEqual(['new Function('])
    }
    expect(parse("new window.WebSocket('wss://live.test/x')")).toEqual(['new WebSocket(', 'host:live.test'])
    expect(parse('const c = new globalThis.XMLHttpRequest()')).toEqual(['new XMLHttpRequest('])
    expect(parse('const i = new window.Image()')).toEqual(['new Image('])
  })

  it('does not see a constructor through any other qualifier (a library\'s Image is not the browser\'s), or a global one the scan does not name (T-127 (5))', () => {
    expect(parse('new Konva.Image({ image })')).toEqual([])
    expect(parse('const node = new Konva.Image()')).toEqual([])
    expect(parse('new this.Image()')).toEqual([])
    expect(parse('new a.b.WebSocket(u)')).toEqual([])
    expect(parse('new window.top.WebSocket(u)'), 'a longer chain is another qualifier on purpose').toEqual([])
    expect(parse('new window.Map()')).toEqual([])
    expect(parse('new globalThis.Date()')).toEqual([])
    expect(parse('new Map()')).toEqual([])
  })

  it('sees eval and Function through a global too (T-127 (5)), and not a method that is only called eval', () => {
    expect(parse("window.eval('1')")).toEqual(['eval('])
    expect(parse("globalThis.eval('require')('https')")).toEqual(['eval('])
    expect(parse("self.eval('1')")).toEqual(['eval('])
    expect(parse('model.eval(x)')).toEqual([])
    expect(parse('new Konva.Function()')).toEqual([])
  })

  // T-127 (6): each of these returned [] (a module load that is not an `import`, a `require(` or an `import(`).
  it('sees a module load with no import in sight: process.getBuiltinModule, createRequire, an export-from, import = require (T-127 (6))', () => {
    expect(parse("process.getBuiltinModule('node:https').get(u)")).toEqual(['getBuiltinModule('])
    expect(parse("const m = getBuiltinModule('node:net')")).toEqual(['getBuiltinModule('])
    expect(parse('const m = process.getBuiltinModule(name)')).toEqual(['getBuiltinModule('])
    expect(parse("createRequire(import.meta.url)('node:net')")).toEqual(['createRequire('])
    expect(parse("const req = createRequire(import.meta.url)\nreq('node:https')")).toEqual(['createRequire('])
    expect(parse("const req = module.createRequire(__filename)")).toEqual(['createRequire('])
    expect(parse("export * from 'node:https'")).toEqual(['import:https'])
    expect(parse("export * as h from 'node:http'")).toEqual(['import:http'])
    expect(parse("export { get } from 'node:https'")).toEqual(['import:https'])
    expect(parse("export { request as r } from 'undici'")).toEqual(['import:undici'])
    expect(parse("import https = require('node:https')")).toEqual(['import:https'])
    expect(parse("import x = require('electron-updater')")).toEqual(['import:electron-updater'])
  })

  it('does not see the same words doing nothing: an import of createRequire, a local or type-only export, a local import =, a method called getBuiltinModule on nothing (T-127 (6))', () => {
    expect(parse("import { createRequire } from 'node:module'")).toEqual([])
    expect(parse("export { x } from './local'")).toEqual([])
    expect(parse("export * from './shared'")).toEqual([])
    expect(parse("export type { X } from 'node:https'")).toEqual([])
    expect(parse("export { type X, type Y } from 'node:https'")).toEqual([])
    expect(parse("export { type X, y } from 'node:https'"), 'one real name makes it a load').toEqual(['import:https'])
    expect(parse("import local = require('./local')")).toEqual([])
    expect(parse('export const a = 1')).toEqual([])
    expect(parse('const a = 1\nexport { a }')).toEqual([])
    expect(parse('const m = createRequireStub')).toEqual([])
  })

  // T-127 (12): the header named these and only https.get had a case.
  it('sees http.request, http.get and https.request as well as https.get, and not another object\'s request or get (T-127 (12))', () => {
    expect(parse("https.get('x')")).toEqual(['http(s).request('])
    expect(parse('http.get(u, cb)')).toEqual(['http(s).request('])
    expect(parse('http.request(options, cb)')).toEqual(['http(s).request('])
    expect(parse('https.request(options, cb)')).toEqual(['http(s).request('])
    expect(parse('cache.get(key)')).toEqual([])
    expect(parse('map.request(x)')).toEqual([])
    expect(parse('httpClient.request(o)')).toEqual([])
    expect(parse('myhttp.get(k)')).toEqual([])
  })

  it('sees EVERY module the set names, each one named here, so a module dropped from the set (or a branch that stops reading one) fails (T-127 (12))', () => {
    // Written out, not derived from NETWORK_MODULES: a table taken from the set would shrink with it.
    const table = [
      'http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'ws', 'undici', 'axios', 'node-fetch', 'got', 'superagent', 'socket.io-client',
      'cross-fetch', 'isomorphic-fetch', 'ky', 'needle', 'request', 'electron-updater', 'update-electron-app', '@sentry', '@bugsnag',
      '@datadog', '@amplitude', '@segment', '@opentelemetry', 'posthog-js', 'posthog-node', 'mixpanel', 'mixpanel-browser', 'amplitude-js',
      'rollbar', 'logrocket', 'firebase', 'applicationinsights', 'use-image', 'wavesurfer.js', 'child_process'
    ]
    expect([...NETWORK_MODULES].sort(), 'the table and the set are the same list: add a module to both').toEqual([...table].sort())
    const builtins = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'child_process']
    for (const m of table) {
      const sub = m.startsWith('@') ? `${m}/pkg` : m
      expect(parse(`import x from '${sub}'`), `import ${sub}`).toEqual([`import:${m}`])
      expect(parse(`const x = require('${sub}')`), `require('${sub}')`).toEqual([`import:${m}`])
      expect(parse(`const x = await import('${sub}')`), `import('${sub}')`).toEqual([`import:${m}`])
      expect(parse(`export * from '${sub}'`), `export * from '${sub}'`).toEqual([`import:${m}`])
    }
    for (const m of builtins) {
      expect(parse(`import x from 'node:${m}'`), `import node:${m}`).toEqual([`import:${m}`])
      expect(parse(`const x = require('node:${m}')`), `require('node:${m}')`).toEqual([`import:${m}`])
    }
    expect(parse("import { x } from 'tls-like-but-local'"), 'a name that only starts like one').toEqual([])
    expect(parse("import { x } from 'node:fs'")).toEqual([])
    expect(parse("import { x } from 'node:path'")).toEqual([])
  })

  // T-127 (13): the last gaps in the vocabulary. Each of the positives returned [] (or, for the style sheets, passed).
  it('sees the page navigating through a chain of globals: window.top.location.href, window.parent.location.assign (T-127 (13))', () => {
    expect(parse('window.top.location.href = u')).toEqual(['location.href ='])
    expect(parse('window.parent.location.href = u')).toEqual(['location.href ='])
    expect(parse('top.location.href = u')).toEqual(['location.href ='])
    expect(parse('parent.location.hostname = h')).toEqual(['location.hostname ='])
    expect(parse('globalThis.top.location.protocol = "http:"')).toEqual(['location.protocol ='])
    expect(parse('window.top.location = u')).toEqual(['location ='])
    expect(parse('top.location = u')).toEqual(['location ='])
    expect(parse('window.top.location.assign(u)')).toEqual(['location.assign('])
    expect(parse('window.parent.location.replace(u)')).toEqual(['location.replace('])
    expect(parse('window.document.location.href = u')).toEqual(['location.href ='])
    // The negatives stay: a write that stays in the page, a read, a reload, and a `location` that is some other object's.
    expect(parse("window.top.location.hash = '#x'")).toEqual([])
    expect(parse('window.parent.location.pathname = p')).toEqual([])
    expect(parse('window.top.location.reload()')).toEqual([])
    expect(parse('const h = window.top.location.href')).toEqual([])
    expect(parse('props.top.location.href = u')).toEqual([])
    expect(parse('config.parent.location = here')).toEqual([])
  })

  it('sees a bracketed IPv6 host in a literal, in code and in JSX text, in any letter case (T-127 (13))', () => {
    expect(parse("const u = 'http://[::1]:8080/x'")).toEqual(['host:[::1]'])
    expect(parse("const u = 'wss://[2001:DB8::1]/s'")).toEqual(['host:[2001:db8::1]'])
    expect(parse("const u = `https://[fe80::1]/${id}`")).toEqual(['host:[fe80::1]'])
    expect(parse('const x = <p>see http://[::1]/docs</p>')).toEqual(['host:[::1]'])
    expect(parse("const u = 'HTTP://[::FFFF:127.0.0.1]/'")).toEqual(['host:[::ffff:127.0.0.1]'])
    // Not an address: an unclosed bracket, and a scheme with no host.
    expect(parse("const u = 'http://[::1'")).toEqual([])
    expect(parse("const u = 'http://'")).toEqual([])
  })

  it('sees image-set( beside url( in a computed style, and not a computed value that loads nothing (T-127 (13))', () => {
    expect(parse('const s = { backgroundImage: `image-set("${src}" 1x)` }')).toEqual(['image-set(${})'])
    // One site per loader: the file is a site at the first address, which is what the list needs (a second candidate is not another `image-set(`).
    expect(parse("const s = `image-set('${a}' 1x, '${b}' 2x)`")).toEqual(['image-set(${})'])
    expect(parse('const s = `-webkit-image-set(${src} 1x)`')).toEqual(['image-set(${})'])
    expect(parse('const s = `image-set( "${src}" 1x)`')).toEqual(['image-set(${})'])
    expect(parse('const s = `-webkit-image-set(url(${src}) 1x)`'), 'the url( inside is the site').toEqual(['url(${})'])
    expect(parse('const s = `image-set(url("a.png") 1x) no-repeat`')).toEqual([])
    expect(parse('const s = `scale(${x})`')).toEqual([])
    expect(parse('const s = `reset(${x})`')).toEqual([])
  })

  it('the style-sheet check sees a remote image-set( as well as a remote url(, with a scheme or protocol-relative, and lets a local one through (T-127 (13))', () => {
    expect(remoteCssLoad('a{background:url(https://x.test/a.png)}')).toContain('https://x.test/a.png')
    expect(remoteCssLoad("a{background:url( 'HTTP://x.test/a.png' )}")).not.toBeNull()
    expect(remoteCssLoad('a{background:url(//cdn.test/a.png)}')).not.toBeNull()
    expect(remoteCssLoad('a{background:image-set("https://x.test/a.png" 1x)}')).toContain('image-set(')
    expect(remoteCssLoad("a{background:image-set('//x.test/a.png' 1x, '//x.test/a@2x.png' 2x)}")).not.toBeNull()
    expect(remoteCssLoad('a{background:-webkit-image-set( "wss://x.test/a.png" 1x)}')).not.toBeNull()
    // Local: a relative path, a data URI, a fragment, the bundled font's relative path, and an address that is only in a comment.
    expect(remoteCssLoad('a{background:image-set("a.png" 1x, "a@2x.png" 2x)}')).toBeNull()
    expect(remoteCssLoad('a{background:image-set(url(./a.png) 1x)}')).toBeNull()
    expect(remoteCssLoad('a{background:url(data:image/png;base64,AAAA)}')).toBeNull()
    expect(remoteCssLoad('a{mask:url(#m)}')).toBeNull()
    expect(remoteCssLoad('@font-face{src:url("./inter-latin-400-normal-x.woff2") format("woff2")}')).toBeNull()
    expect(remoteCssLoad('/* url(https://x.test/a.png) image-set("//x.test/a" 1x) */ a{color:red}')).toBeNull()
  })

  it('the source reader\'s own limit is checked: a .js / .jsx / .mjs / .cjs file anywhere, or any code below the eighth level, is named (T-127 (13))', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'imagii-netscan-'))
    const put = (relative: string): void => {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      writeFileSync(path.join(root, relative), '')
    }
    try {
      for (const f of ['a.ts', 'b.tsx', 'c.css', 'index.html', 'a.test.ts', 'sub/d.ts', 'd1/d2/d3/d4/d5/d6/d7/d8/ok-at-eight.ts']) put(f)
      expect(unreadableSourceIn(root), 'only code the scan reads').toEqual([])
      for (const f of ['x.js', 'w.jsx', 'sub/y.mjs', 'sub/deeper/z.cjs', 'UP.JS', 'd1/d2/d3/d4/d5/d6/d7/d8/d9/too-deep.ts']) put(f)
      expect(unreadableSourceIn(root).sort()).toEqual([
        'UP.JS', 'd1/d2/d3/d4/d5/d6/d7/d8/d9/too-deep.ts', 'sub/deeper/z.cjs', 'sub/y.mjs', 'w.jsx', 'x.js'
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('the package check names an updater, telemetry or crash SDK, and a `publish` key; not the real dependencies, a comment, or a word inside a name', () => {
    expect(phoneHomePackages(['electron-updater', '@sentry/electron', 'react', 'posthog-js', 'mixpanel-browser', '@datadog/browser-rum', 'bugsnag-js'])).toEqual([
      'electron-updater',
      '@sentry/electron',
      'posthog-js',
      'mixpanel-browser',
      '@datadog/browser-rum',
      'bugsnag-js'
    ])
    expect(phoneHomePackages(['electron-store', 'ffmpeg-static', 'konva', 'react-hot-toast', 'use-image', 'wavesurfer.js', 'zustand'])).toEqual([])
    // T-127 (14): the names come from BOTH sections (Vite bundles whatever the renderer imports, from either).
    expect(phoneHomeInPackage({ dependencies: { react: '1' }, devDependencies: { '@sentry/browser': '1' } })).toEqual(['@sentry/browser'])
    expect(phoneHomeInPackage({ dependencies: { 'electron-updater': '1' }, devDependencies: { 'posthog-js': '1' } })).toEqual(['electron-updater', 'posthog-js'])
    expect(phoneHomeInPackage({ dependencies: { react: '1' }, devDependencies: { vite: '1' } })).toEqual([])
    expect(phoneHomeInPackage({})).toEqual([])
    expect(hasPublishKey('win:\n  target: portable\npublish:\n  provider: github\n')).toBe(true)
    expect(hasPublishKey('win:\n  publish:\n    - url: https://x.test\n')).toBe(true)
    expect(hasPublishKey('publish: null\n')).toBe(true)
    expect(hasPublishKey('# publish: github (never)\nwin:\n  target: portable\n')).toBe(false)
    expect(hasPublishKey('portable:\n  artifactName: published.exe\n')).toBe(false)
  })
})
