import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as unzipper from 'unzipper';

const GITHUB_ZIP_URL = 'https://codeload.github.com/finnjclancy/dev-prompts/zip/refs/heads/main';
const ZIP_ROOT_DIR = 'dev-prompts-main';
const PROMPTS_DIR_IN_REPO = path.posix.join(ZIP_ROOT_DIR, 'prompts');

async function downloadZip(tempFilePath: string, token?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      headers: {}
    };
    if (token) {
      (options.headers as Record<string, string>)['Authorization'] = `token ${token}`;
      (options.headers as Record<string, string>)['User-Agent'] = 'dev-prompts-extension';
    }
    const req = https.get(GITHUB_ZIP_URL, options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, (redirectRes) => {
          pipeToFile(redirectRes, tempFilePath, resolve, reject);
        }).on('error', reject);
        return;
      }
      pipeToFile(res, tempFilePath, resolve, reject);
    });
    req.on('error', reject);
  });
}

function pipeToFile(stream: NodeJS.ReadableStream, filePath: string, resolve: () => void, reject: (err: unknown) => void) {
  const writeStream = fs.createWriteStream(filePath);
  stream.pipe(writeStream);
  writeStream.on('finish', () => resolve());
  writeStream.on('error', reject);
}

async function extractPromptsFromZip(zipFilePath: string, destinationDir: string): Promise<void> {
  await fs.promises.mkdir(destinationDir, { recursive: true });

  const directory = await unzipper.Open.file(zipFilePath);
  const promptsEntries = directory.files.filter((f: any) => f.path.replace(/\\/g, '/')
    .startsWith(`${PROMPTS_DIR_IN_REPO}/`) && !f.path.endsWith('/'));

  for (const entry of promptsEntries) {
    const relative = entry.path.replace(/\\/g, '/').substring(PROMPTS_DIR_IN_REPO.length + 1);
    const outPath = path.join(destinationDir, relative);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      entry.stream()
        .pipe(fs.createWriteStream(outPath))
        .on('finish', () => resolve())
        .on('error', (err: unknown) => reject(err));
    });
  }
}

type ConflictChoice = 'overwrite' | 'skip' | 'rename';

async function handleConflicts(destDir: string, files: string[]): Promise<{ choice: ConflictChoice; map: Map<string, string>; }> {
  const existing = await Promise.all(files.map(async (f) => ({
    relative: f,
    exists: await fileExists(path.join(destDir, f))
  })));
  const anyExisting = existing.some((e) => e.exists);
  let choice: ConflictChoice = 'overwrite';
  const mapping = new Map<string, string>();
  files.forEach((f) => mapping.set(f, f));
  if (!anyExisting) return { choice, map: mapping };

  const picked = await vscode.window.showInformationMessage(
    'Some prompt files already exist in ./prompts. How should conflicts be handled?',
    { modal: true, detail: 'you can apply this choice to all conflicts.' },
    'Overwrite', 'Skip', 'Rename'
  );
  if (picked === 'Skip') choice = 'skip';
  else if (picked === 'Rename') choice = 'rename';

  if (choice === 'rename') {
    for (const f of files) {
      const destPath = path.join(destDir, f);
      if (await fileExists(destPath)) {
        const ext = path.extname(f);
        const base = path.basename(f, ext);
        const dir = path.dirname(f);
        let idx = 1;
        let candidate: string;
        do {
          candidate = path.join(dir, `${base} (copy ${idx})${ext}`);
          idx += 1;
        } while (await fileExists(path.join(destDir, candidate)));
        mapping.set(f, candidate);
      }
    }
  }
  return { choice, map: mapping };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function listFilesUnder(dir: string): Promise<string[]> {
  const results: string[] = [];
  const directory = await unzipper.Open.file(dir);
  for (const file of directory.files) {
    const normalized = file.path.replace(/\\/g, '/');
    if (normalized.startsWith(`${PROMPTS_DIR_IN_REPO}/`) && !normalized.endsWith('/')) {
      const rel = normalized.substring(PROMPTS_DIR_IN_REPO.length + 1);
      results.push(rel);
    }
  }
  return results;
}

async function importPrompts(showNotifications = true) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('Dev Prompts: no workspace folder is open.');
    return;
  }
  const root = workspaceFolders[0].uri.fsPath;
  const destDir = path.join(root, 'prompts');

  await fs.promises.mkdir(destDir, { recursive: true });
  const tmpZip = path.join(os.tmpdir(), `dev-prompts-${Date.now()}.zip`);
  const token = process.env.GITHUB_TOKEN;
  const progressOpts: vscode.ProgressOptions = { location: vscode.ProgressLocation.Notification, title: 'Dev Prompts: importing...', cancellable: false };

  await vscode.window.withProgress(progressOpts, async () => {
    await downloadZip(tmpZip, token);
    const tmpListZip = tmpZip; // reuse to list entries
    const files = await listFilesUnder(tmpListZip);
    const { choice, map } = await handleConflicts(destDir, files);
    await extractPromptsFromZipWithMapping(tmpZip, destDir, choice, map);
  });

  if (showNotifications) {
    vscode.window.showInformationMessage('Dev Prompts: import complete.');
  }
}

async function extractPromptsFromZipWithMapping(zipFilePath: string, destinationDir: string, choice: ConflictChoice, mapping: Map<string, string>) {
  const directory = await unzipper.Open.file(zipFilePath);
  const entries = directory.files.filter((f: any) => f.path.replace(/\\/g, '/')
    .startsWith(`${PROMPTS_DIR_IN_REPO}/`) && !f.path.endsWith('/'));

  for (const entry of entries) {
    const rel = entry.path.replace(/\\/g, '/').substring(PROMPTS_DIR_IN_REPO.length + 1);
    const mappedRel = mapping.get(rel) ?? rel;
    const outPath = path.join(destinationDir, mappedRel);

    const exists = await fileExists(path.join(destinationDir, rel));
    if (exists) {
      if (choice === 'skip') continue;
    }

    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      entry.stream()
        .pipe(fs.createWriteStream(outPath))
        .on('finish', () => resolve())
        .on('error', (err: unknown) => reject(err));
    });
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const importCmd = vscode.commands.registerCommand('dev-prompts.importPrompts', async () => {
    await importPrompts(true);
  });
  const syncCmd = vscode.commands.registerCommand('dev-prompts.syncPrompts', async () => {
    await importPrompts(true);
  });
  const searchCmd = vscode.commands.registerCommand('dev-prompts.searchAndImport', async () => {
    await searchAndImportPrompts();
  });
  context.subscriptions.push(importCmd, syncCmd, searchCmd);

  const config = vscode.workspace.getConfiguration();
  const auto = config.get<boolean>('devPrompts.autoImportOnActivate', false);
  if (auto) {
    importPrompts(false).catch((err) => console.error('Dev Prompts auto-import error:', err));
  }
}

export function deactivate() {}

type RepoEntry = { path: string; type: 'file' | 'dir' };

async function fetchRepoTreePaths(token?: string): Promise<RepoEntry[]> {
  // try GitHub Tree API first
  const treeUrl = 'https://api.github.com/repos/finnjclancy/dev-prompts/git/trees/main?recursive=1';
  try {
    const json = await httpGetJson(treeUrl, token);
    if (json && Array.isArray(json.tree)) {
      const results: RepoEntry[] = [];
      for (const node of json.tree) {
        if (typeof node.path !== 'string' || typeof node.type !== 'string') continue;
        const normalized = node.path.replace(/\\/g, '/');
        if (!normalized.startsWith('prompts/')) continue;
        const isDir = node.type === 'tree';
        const isFile = node.type === 'blob';
        if (isDir) results.push({ path: normalized, type: 'dir' });
        if (isFile) results.push({ path: normalized, type: 'file' });
      }
      return results;
    }
  } catch {
    // fall through to zip fallback
  }

  // fallback: download zip and enumerate entries
  const tmpZip = path.join(os.tmpdir(), `dev-prompts-list-${Date.now()}.zip`);
  await downloadZip(tmpZip, token);
  const directory = await unzipper.Open.file(tmpZip);
  const entries: RepoEntry[] = [];
  for (const f of directory.files) {
    const p = f.path.replace(/\\/g, '/');
    if (!p.startsWith(`${ZIP_ROOT_DIR}/prompts/`)) continue;
    if (p.endsWith('/')) {
      entries.push({ path: p.substring(ZIP_ROOT_DIR.length + 1), type: 'dir' });
    } else {
      entries.push({ path: p.substring(ZIP_ROOT_DIR.length + 1), type: 'file' });
    }
  }
  return entries;
}

async function httpGetJson(url: string, token?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': 'dev-prompts-extension',
      'Accept': 'application/vnd.github+json'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function toQuickPickItems(entries: RepoEntry[], query?: string): vscode.QuickPickItem[] & { _path?: string; _type?: 'file' | 'dir' }[] {
  const filtered = entries.filter((e) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return e.path.toLowerCase().includes(q);
  });
  filtered.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  return filtered.map((e) => ({
    label: e.type === 'dir' ? `$(folder) ${e.path}` : `$(file) ${e.path}`,
    description: e.type === 'dir' ? 'directory' : 'file',
    _path: e.path,
    _type: e.type
  }));
}

async function searchAndImportPrompts(): Promise<void> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('Dev Prompts: no workspace folder is open.');
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  const entries = await fetchRepoTreePaths(token);
  if (entries.length === 0) {
    vscode.window.showWarningMessage('Dev Prompts: no prompts found to search.');
    return;
  }

  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { _path?: string; _type?: 'file' | 'dir' }>();
  qp.title = 'Dev Prompts: search and import';
  qp.canSelectMany = true;
  qp.placeholder = 'type to search prompts (folders and files)';
  qp.items = toQuickPickItems(entries);
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;

  qp.onDidChangeValue((value) => {
    qp.items = toQuickPickItems(entries, value);
  });

  const selection = await new Promise<(vscode.QuickPickItem & { _path?: string; _type?: 'file' | 'dir' })[] | undefined>((resolve) => {
    qp.onDidAccept(() => {
      resolve(qp.selectedItems as any);
      qp.hide();
    });
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });

  if (!selection || selection.length === 0) return;

  await importSelection(selection);
}

async function importSelection(items: (vscode.QuickPickItem & { _path?: string; _type?: 'file' | 'dir' })[]) {
  const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const destDir = path.join(workspaceRoot, 'prompts');
  await fs.promises.mkdir(destDir, { recursive: true });

  const tmpZip = path.join(os.tmpdir(), `dev-prompts-${Date.now()}.zip`);
  const token = process.env.GITHUB_TOKEN;
  await downloadZip(tmpZip, token);
  const zipDir = await unzipper.Open.file(tmpZip);

  // collect all entries to write
  const fileWrites: { rel: string; entry: any }[] = [];
  for (const zEntry of zipDir.files) {
    const p = zEntry.path.replace(/\\/g, '/');
    if (!p.startsWith(`${ZIP_ROOT_DIR}/prompts/`) || p.endsWith('/')) continue;
    const rel = p.substring(`${ZIP_ROOT_DIR}/`.length); // prompts/.../file
    const include = items.some((it) => {
      const target = it._path!; // prompts/... or prompts/.../file
      if (it._type === 'dir') {
        return rel.startsWith(target + '/');
      }
      return rel === target;
    });
    if (include) fileWrites.push({ rel: rel.substring('prompts/'.length), entry: zEntry });
  }

  const files = fileWrites.map((f) => f.rel);
  const { choice, map } = await handleConflicts(destDir, files);

  let written = 0;
  for (const f of fileWrites) {
    const mappedRel = map.get(f.rel) ?? f.rel;
    const outPath = path.join(destDir, mappedRel);
    const exists = await fileExists(path.join(destDir, f.rel));
    if (exists && choice === 'skip') continue;
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      f.entry.stream()
        .pipe(fs.createWriteStream(outPath))
        .on('finish', () => resolve())
        .on('error', (err: unknown) => reject(err));
    });
    written += 1;
  }

  vscode.window.showInformationMessage(`Dev Prompts: imported ${written} item(s).`);
}

