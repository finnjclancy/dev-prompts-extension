# dev prompts (vscode extension)

bring a shared set of developer prompts into your project with one command. it pulls everything under `prompts/` from the shared repo and drops it into your workspace `./prompts` folder.

- source: [`finnjclancy/dev-prompts`](https://github.com/finnjclancy/dev-prompts)
- prompts path: [`/prompts`](https://github.com/finnjclancy/dev-prompts/tree/main/prompts)

## what it does

- imports everything from the repo’s `prompts/` folder
- writes into your project’s `./prompts` folder (at the root)
- handles conflicts with one choice for all files: overwrite / skip / rename

## commands

- dev prompts: import prompts – fetch and write `./prompts`
- dev prompts: sync prompts – re-fetch and apply the same rules
- dev prompts: search and import – fuzzy‑search folders/files under `prompts/` and import selected items (multi‑select)

### how search works

- searches both folder names and file names (and their paths) inside `finnjclancy/dev-prompts@main/prompts/`
- results show paths like `prompts/languages/javascript` (directories first, then files)
- you can multi‑select any mix of folders and files
- importing a folder brings in the whole subtree; importing a file brings just that file
- conflict handling uses your one‑time choice (overwrite / skip / rename → applies to all)

## optional setting

- devPrompts.autoImportOnActivate (default: false)
  - if true, imports on vscode startup without asking

## quick start (local dev)

1) clone this repo
2) `npm install`
3) `npm run compile`
4) press F5 in vscode to launch an extension development host

then, from the command palette (cmd/ctrl+shift+p):
- run “dev prompts: import prompts” to fetch the latest
- or try “dev prompts: search and import”, type something like `javascript`, multi‑select matches, hit enter

## notes

- destination is always `./prompts` at the workspace root (v1)
- source is fixed to `main` branch of the shared repo (v1)
- if you hit github rate limits, set a `GITHUB_TOKEN` env var before importing
