// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('[Shift Saver] activated');

	const camelCaseModeDecoration = vscode.window.createTextEditorDecorationType({
		'border': '1px solid',
		'borderColor': '#62ddc7',
		'borderRadius': '5px',
		'after': {
			'contentIconPath': context.asAbsolutePath('camel-case.svg'),
			'margin': '-5px 2px 0 0',
		}
	});

	const underscoreModeDecoration = vscode.window.createTextEditorDecorationType({
		'border': '1px solid',
		'borderColor': '#eefb84',
		'borderRadius': '5px',
		'after': {
			'contentIconPath': context.asAbsolutePath('underscore.svg'),
			'margin': '-5px 2px 0 0',
		}
	});

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerTextEditorCommand('shift-saver.createName', (editor) => {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('Shift Saver: naming start');

		const naming = new NamingInProgress(editor.selection.start);
		let ignoreSelectionChange = false;
		let ignoreContentChange = false;
		// let lineBackup: string;
		updateView();

		const unsubscribeTextChange = vscode.workspace.onDidChangeTextDocument(event => {
			// console.log('text change');
			if (vscode.window.activeTextEditor !== editor) {
				return;
			}
			if (ignoreContentChange) {
				ignoreContentChange = false;
				return;
			}
			const change = event.contentChanges[0];
			// console.log(`[changed] first change: isEmpty=${change.range.isEmpty} text=${change.text}`);
			naming.onContentChange(change.range, change.text);
			ignoreSelectionChange = true;
			updateView();
		});

		const unsubscribeSelectionChange = vscode.window.onDidChangeTextEditorSelection(() => {
			if (vscode.window.activeTextEditor !== editor) {
				return;
			}
			if (ignoreSelectionChange) {
				ignoreSelectionChange = false;
				return;
			}
			// console.log(`changed: ${editor.document.lineAt(naming.affectedRange.start).text !== lineBackup}`);
			// if (editor.document.lineAt(naming.affectedRange.start).text !== lineBackup) {
			// 	return;
			// }
			// console.log(`line: <${editor.document.lineAt(naming.affectedRange.start).text}>`);
			naming.onSelectionChange(editor.document.validatePosition(editor.selection.start));
			updateView();
		});

		function updateView() {
			naming.doReplace((replaced, content) => {
				if (editor.document.getText(replaced) !== content) {
					editor.edit(edit => {
						edit.replace(replaced, content);
					});
					ignoreContentChange = true;
				}
			});

			editor.setDecorations(camelCaseModeDecoration, []);
			editor.setDecorations(underscoreModeDecoration, []);
			if (naming.isFinished) {
				unsubscribeTextChange.dispose();
				unsubscribeSelectionChange.dispose();
				vscode.window.showInformationMessage('Shift Saver: naming finished');
				return;
			}

			let decorationType;
			switch (naming.mode) {
				case NamingConvension.camelCase:
					decorationType = camelCaseModeDecoration;
					break;
				case NamingConvension.underscore:
					decorationType = underscoreModeDecoration;
					break;
			}
			editor.setDecorations(decorationType, [naming.affectedRange]);
			if (!editor.selection.start.isEqual(naming.cursor)) {
				editor.selection = new vscode.Selection(naming.cursor, naming.cursor);
			}
			// lineBackup = editor.document.lineAt(naming.affectedRange.start).text;
		}
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() { }

enum NamingConvension {
	camelCase,
	underscore,
}

class NamingInProgress {
	mode: NamingConvension;
	static defaultMode: NamingConvension = NamingConvension.camelCase;
	isFinished: boolean;
	raw: string;
	modified: string;
	affectedRange: vscode.Range;
	cursor: vscode.Position;

	constructor(startPosition: vscode.Position) {
		this.mode = NamingInProgress.defaultMode;
		this.isFinished = false;
		this.raw = this.modified = '';
		this.affectedRange = new vscode.Range(startPosition, startPosition);
		this.cursor = startPosition;
	}

	onContentChange(range: vscode.Range, text: string) {
		if (range.isEmpty) {
			if (text === ' ' && this.affectedRange.isEmpty) {
				switch (this.mode) {
					case NamingConvension.camelCase:
						this.mode = NamingConvension.underscore;
						break;
					case NamingConvension.underscore:
						this.mode = NamingConvension.camelCase;
						break;
				}
			} else {
				const insertPosition = range.start.character - this.affectedRange.start.character;
				this.modified = [
					this.modified.slice(0, insertPosition),
					text.toUpperCase(),
					this.modified.slice(insertPosition),
				].join('');
				this.cursor = this.cursor.translate(0, text.length);
			}
			this.affectedRange = new vscode.Range(
				this.affectedRange.start, this.affectedRange.end.translate(0, text.length));
		}
	}

	onSelectionChange(cursor: vscode.Position) {
		// console.log(`cursor: ${cursor.line}, ${cursor.character}`);
		// console.log(`affected: ${this.affectedRange.start.line}, ${this.affectedRange.start.character} -> ${this.affectedRange.end.line}, ${this.affectedRange.end.character}`)
		if (cursor.isBefore(this.affectedRange.start) || cursor.isAfter(this.affectedRange.end)) {
			this.isFinished = true;
		} else {
			this.cursor = cursor;
		}
	}

	doReplace(onReplace: (replaced: vscode.Range, newContent: string) => void) {
		onReplace(this.affectedRange, this.modified);
		this.affectedRange = new vscode.Range(
			this.affectedRange.start, this.affectedRange.start.translate(0, this.modified.length));
	}
}
