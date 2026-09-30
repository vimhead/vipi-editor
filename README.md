# vipir-editor

One Vim editing system for Pi’s prompt, inputs, and textareas, with a shared Vim engine, focus coordinator, and cursor control.

## Install

```sh
pi install git:github.com/vimhead/vipir-editor
```

Use current Pi and Node.js 24+. Reload Pi after installation.

## Use

- **Esc** enters normal mode; **i**, **a**, **o**, and **O** enter insert mode.
- Vim motions, operators, text objects, clipboard editing, and undo work in the editors.
- Closing a field restores the previous editor’s focus; each editor keeps its own text and mode.

[Jump mode](https://github.com/vimhead/vipir-jump), [command palette](https://github.com/vimhead/vipir-palette), and [keyboard-layout switching](https://github.com/vimhead/vipir-input-source) are separate plugins. Install and toggle them individually in `/vipir`.

## Extension fields

Import `createFieldControls` from `vipir-editor/api`, then call `createFieldControls(pi)`. After `session_start`, use `fields.createInput(options)` or `fields.createTextarea(options)` with Pi’s `tui`, `theme`, `keybindings`, `initialValue`, `placeholder`, `focused`, and `onRequestRender`.

Forward rendering and input to the field, propagate the host component’s `focused` state, and check `capturesInput?.(data)` before dialog-level Escape. Read text with `getValue()`. Dispose each field when closing it and the factory with `fields.dispose()` when finished. Fields require the active vipir-editor session and share its focus and layout coordination.

Disable the whole editor in `/vipir`, or run `pi remove git:github.com/vimhead/vipir-editor` and reload.
