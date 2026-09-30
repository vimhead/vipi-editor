# vipi-editor

One Vim editing system for Pi’s prompt, inputs, and textareas, with a shared Vim engine, focus coordinator, and cursor control.

## Install

```sh
pi install git:github.com/vimhead/vipi-editor
```

Use current Pi and Node.js 24+. Reload Pi after installation.

## Use

- **Esc** enters normal mode; **i**, **a**, **o**, and **O** enter insert mode.
- Vim motions, operators, text objects, clipboard editing, and undo work in the editors.
- Closing a field restores the previous editor’s focus; each editor keeps its own text and mode.

[Jump mode](https://github.com/vimhead/pi-me-jump-mode), [command palette](https://github.com/vimhead/pi-me-command-palette), and [keyboard-layout switching](https://github.com/vimhead/pi-me-input-source) are separate plugins. Install and toggle them individually in `/vipi`.

## Extension fields

Import `createFieldControls` from `vipi-editor/api`, then call `createFieldControls(pi)`. After `session_start`, use `fields.createInput(options)` or `fields.createTextarea(options)` with Pi’s `tui`, `theme`, `keybindings`, `initialValue`, `placeholder`, `focused`, and `onRequestRender`.

Forward rendering and input to the field, propagate the host component’s `focused` state, and check `capturesInput?.(data)` before dialog-level Escape. Read text with `getValue()`. Dispose each field when closing it and the factory with `fields.dispose()` when finished. Fields require the active vipi-editor session and share its focus and layout coordination.

Disable the whole editor in `/vipi`, or run `pi remove git:github.com/vimhead/vipi-editor` and reload.
