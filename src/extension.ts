'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs'
import * as path from 'path'
import * as child_process from 'child_process'
import { RelativePattern } from 'vscode';

function readFileAsync(file : string) : Promise<string> {
    return new Promise(function (resolve, reject) {
        fs.readFile(file, 'utf8', (error : NodeJS.ErrnoException, result : string) => {
            if (error) {
            reject(error);
            } else {
            resolve(result);
            }
        });
    });
}

function writeFileAsync(file: string, content: string) : Promise<void> {
    return new Promise(function (resolve, reject) {
        fs.writeFile(file, content, (err: NodeJS.ErrnoException) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        })
    })
}

function executeCommandAsync(command: string, rootDir: string) : Promise<string> {
    return new Promise(function (resolve, reject) {
        let exec = child_process.exec;
        let child = exec(command, {
            cwd: rootDir
        }, (err, stdout, stderr) => {
            if (err) {
                reject(err);
            } else {
                resolve(stdout);
            }
        });
    })
}

function executeGccCommandAsync(command: string) : Promise<string> {
    return new Promise(function (resolve, reject) {
        let exec = child_process.exec;
        let child = exec(command, {
        }, (err, stdout, stderr) => {
            //  #include <...> search starts here:
            if (stderr.indexOf('#include <...> search starts here:') >= 0) {
                resolve(stderr);
            } else {
                reject(err);
            }
        });
    })
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "vscode-wpilibheaders" is now active!');

    let headers = new WPILibHeaders();

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('wpilibheaders.updateHeaders', async () => {
        // The code you place here will be executed every time your command is executed
        await headers.run();
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(headers);
}

// this method is called when your extension is deactivated
export function deactivate() {
}

function turnHeadersToWorkspaceRoot(headers: string[], root: string) : string[] {
    let fixedHeaders: string[] = [];
    for(let header of headers) {
        fixedHeaders.push('${workspaceRoot}/' + path.relative(root, header));
    }
    return Array.from(new Set(fixedHeaders));
}

async function getWpilibHeaders(workspace: string): Promise<string[]> {
    let result = await executeCommandAsync('gradlew getHeaders', workspace);
    console.log(result);
    let results = result.split('\n');
    let headers: string[] = [];
    for(let r of results) {
        if (r.indexOf('WPIHEADER: ') >= 0) {
            headers.push(r.substring(10).trim());
        }
    }
    return turnHeadersToWorkspaceRoot(headers, workspace);
}

async function getGccIncludeDirectories(): Promise<string[]> {
    let result = await executeGccCommandAsync('arm-frc-linux-gnueabi-g++ -xc++ -E -v  -fsyntax-only  .');
    // Split into text
    let r = result.substring(result.indexOf('#include <...> search starts here:') + '#include <...> search starts here:'.length, result.indexOf('End of search list.'))
    let split = r.split('\n');
    let dirs: string[] = [];
    for (let line of split) {
        let st = line.trim();
        if (st.length == 0) continue;
        dirs.push(path.normalize(st));
    }
    console.log(r);
    return dirs;
}

class WPILibHeaders {
    private _statusBarItem: vscode.StatusBarItem;

    private running: boolean = false;

    public async run(): Promise<void> {
        if (this.running) {
            vscode.window.showInformationMessage('Cannot run twice. Please wait for current header run to finish');
            return;
        }
        this.running = true;

        if (!this._statusBarItem) {
            this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        }

        this._statusBarItem.text = 'Getting WPILib Headers'
        this._statusBarItem.show();

        let gccInclude = await getGccIncludeDirectories();

        await Promise.all(vscode.workspace.workspaceFolders.map(async wp => {
            let relPatern = new RelativePattern(wp, "**/c_cpp_properties.json");
            let files = await vscode.workspace.findFiles(relPatern);
            if (files.length < 1) {
                return;
            }
            let wpiHeaders = await getWpilibHeaders(wp.uri.fsPath);
            let includeDirs = wpiHeaders.concat(gccInclude);
            for (let file of files) {
                let content = await readFileAsync(file.fsPath);
                let parsed = JSON.parse(content);
                parsed.configurations.forEach(element => {

                    element.includePath = includeDirs;
                    if (element.name === 'Win32') {
                        element.intelliSenseMode = 'clang-x64'
                    }
                });
                let stringed = JSON.stringify(parsed, null, 4);
                await writeFileAsync(file.fsPath, stringed);
                let x = 5;

            }
        }));

        this._statusBarItem.hide();
        this.running = false;
    }

    dispose() {
        if (this._statusBarItem) {
            this._statusBarItem.dispose();
        }
    }
}
