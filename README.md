# vipi-editor

One Vim editing system for Pi’s prompt, inputs, and textareas, with shared focus, cursor control, and keyboard-layout switching.

## Install

```sh
pi install git:github.com/vimhead/vipi-editor
```

Use current Pi and Node.js 24+. Reload Pi after installation.

## Use

- **Esc** enters normal mode; **i**, **a**, **o**, and **O** enter insert mode.
- Vim motions, operators, text objects, clipboard editing, and undo work in the editors.
- In the prompt’s normal mode, **s** opens jump mode and **Space Space** opens the command palette.
- Closing a field restores the previous editor’s focus; each editor keeps its own text and mode.
- Keyboard-layout switching uses `macism` on macOS. Set `VIPI_EDITOR_DEFAULT_INPUT_SOURCE` to override `com.apple.keylayout.ABC`.

All features are enabled by default. `/vipi-editor` shows their status. Use `/vipi-editor disable jump-mode`, `command-palette`, or `input-source`; use `enable` to restore a feature, then `/reload`. Choices are saved in `~/.pi/agent/vipi-editor.json`.

## Extension fields

Import `createFieldControls` from `vipi-editor/api`, then call `createFieldControls(pi)`. After `session_start`, use `fields.createInput(options)` or `fields.createTextarea(options)` with Pi’s `tui`, `theme`, `keybindings`, `initialValue`, `placeholder`, `focused`, and `onRequestRender`.

Forward rendering and input to the field, propagate the host component’s `focused` state, and check `capturesInput?.(data)` before dialog-level Escape. Read text with `getValue()`. Dispose each field when closing it and the factory with `fields.dispose()` when finished. Fields require the active vipi-editor session and share its focus and layout coordination.

Disable the whole editor in `/vipi`, or run `pi remove git:github.com/vimhead/vipi-editor` and reload.
