// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from "path";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('[Shift Saver] activated');

	function createDecorationType(color: string, svg: string) {
		return vscode.window.createTextEditorDecorationType({
			'border': '1.25px solid',
			'borderColor': color,
			'borderRadius': '5px',
			'after': {
				'contentIconPath': context.asAbsolutePath(path.join('res', svg)),
				'margin': '-5px 2px 0 0',
			}
		});
	}

	const camelCaseModeDecoration = createDecorationType('#62ddc7', 'camel-case.svg');
	const underscoreModeDecoration = createDecorationType('#eefb84', 'underscore.svg');

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
			// ignoreSelectionChange = true;
			// updateView();
		});

		const unsubscribeSelectionChange = vscode.window.onDidChangeTextEditorSelection(() => {
			if (vscode.window.activeTextEditor !== editor) {
				return;
			}
			if (ignoreSelectionChange) {
				ignoreSelectionChange = false;
				return;
			}
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
				ignoreSelectionChange = true;
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
	modified: string;
	affectedRange: vscode.Range;
	cursor: vscode.Position;
	afterInsertion: boolean;

	constructor(startPosition: vscode.Position) {
		this.mode = NamingInProgress.defaultMode;
		this.isFinished = false;
		this.modified = '';
		this.affectedRange = new vscode.Range(startPosition, startPosition);
		this.cursor = startPosition;
		this.afterInsertion = false;
	}

	onContentChange(range: vscode.Range, text: string) {
		if (range.isEmpty && text.length === 0) {
			return;
		}
		const textLength = text.length;
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
				const insertOffset = range.start.character - this.affectedRange.start.character;
				this.processInsertion(insertOffset, text);
				if (this.isFinished) {
					return;
				}
			}
		} else if (text.length === 0 && this.affectedRange.contains(range)) {
			const deletionOffset = range.start.character - this.affectedRange.start.character;
			const deletionLength = range.end.character - range.start.character;
			this.modified = this.modified.slice(0, deletionOffset) + this.modified.slice(deletionOffset + deletionLength);

		} else {
			// todo: more precise control
			this.exitNaming();
			return;
		}
		this.affectedRange = new vscode.Range(
			this.affectedRange.start, this.affectedRange.end.translate(0, textLength));
	}

	processInsertion(offset: number, text: string) {
		let trimPosition = offset;
		// todo: more reasonable behavior on longer input (e.g. pasted)
		if (text.length === 1) {
			if (/[-_ ]/.test(text)) {
				switch (this.mode) {
					case NamingConvension.underscore:
						text = '_';
						break;
					case NamingConvension.camelCase:
						if (offset === 0) {
							text = '';  // no effect
						} else if (this.modified[offset - 1] === '?') {
							text = '';  // no duplicated upper case indicator
						} else {
							text = '?';  // insert upper case indicator
						}
						break;
				}
			} else if (/[a-zA-Z0-9]/.test(text)) {
				if (offset === 0) {
					// first char's case is unchanged
				} else {
					if (this.mode === NamingConvension.camelCase) {
						if (this.modified[offset - 1] === '?') {
							trimPosition -= 1;
							text = text.toUpperCase();
						} else {
							text = text.toLowerCase();
						}
					} else {
						text = /[A-Z]/.test(this.modified[0]) ? text.toUpperCase() : text.toLowerCase();
					}
				}
			} else {
				this.exitNaming();
				return;
			}
		} else {
			// fixme: not proper for naming with suggestion
			this.exitNaming();
			return;
		}
		this.modified = [
			this.modified.slice(0, trimPosition),
			text,
			this.modified.slice(offset),
		].join('');
		this.cursor = this.cursor.translate(0, text.length - (offset - trimPosition));
		this.afterInsertion = true;
	}

	onSelectionChange(cursor: vscode.Position) {
		// console.log(`cursor: ${cursor.line}, ${cursor.character}`);
		// console.log(`affected: ${this.affectedRange.start.line}, ${this.affectedRange.start.character} -> ${this.affectedRange.end.line}, ${this.affectedRange.end.character}`)
		if (cursor.isBefore(this.affectedRange.start) || cursor.isAfter(this.affectedRange.end)) {
			this.exitNaming();
		} else if (!this.afterInsertion) {
			this.cursor = cursor;
		} else {
			this.afterInsertion = false;
		}
	}

	exitNaming() {
		this.isFinished = true;
		NamingInProgress.defaultMode = this.mode;

		switch (this.mode) {
			case NamingConvension.underscore: {
				let i;
				const len = this.modified.length;
				for (i = len - 1; this.modified[i] === '_'; i -= 1) { }
				this.modified = this.modified.slice(0, i + 1) + ' '.repeat(len - i - 1);
				break;
			}
			case NamingConvension.camelCase:
				if (this.modified[this.modified.length - 1] === '?') {
					this.modified = this.modified.slice(0, this.modified.length - 1) + ' ';
				}
				break;
		}
	}

	doReplace(onReplace: (replaced: vscode.Range, newContent: string) => void) {
		onReplace(this.affectedRange, this.modified);
		this.affectedRange = new vscode.Range(
			this.affectedRange.start, this.affectedRange.start.translate(0, this.modified.length));
	}
}
