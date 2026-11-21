const OPEN = /^\s*\{\{#([A-Z0-9_]+)\}\}\s*$/;
const CLOSE = /^\s*\{\{\/([A-Z0-9_]+)\}\}\s*$/;
const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

/**
 * Renders a cfg template. `{{NAME}}` becomes `vars.NAME`. A `{{#NAME}}` ... `{{/NAME}}` block
 * (markers on their own lines, which are dropped) is kept only when `vars.NAME` is truthy.
 * Throws on an unknown placeholder, an unclosed or stray block marker, or leftover braces.
 */
export function renderTemplate(text, vars) {
  const out = [];
  const open = [];
  const off = () => open.some((block) => !block.on);
  for (const line of text.split(/(?<=\n)/)) {
    const opening = OPEN.exec(line.replace(/\r?\n$/, ''));
    if (opening) {
      open.push({ name: opening[1], on: Boolean(vars[opening[1]]) });
      continue;
    }
    const closing = CLOSE.exec(line.replace(/\r?\n$/, ''));
    if (closing) {
      if (open.at(-1)?.name !== closing[1]) throw new Error(`template: unexpected {{/${closing[1]}}}`);
      open.pop();
      continue;
    }
    if (off()) continue;
    const rendered = line.replace(PLACEHOLDER, (_, name) => {
      if (vars[name] === undefined || vars[name] === null) throw new Error(`template: unknown placeholder {{${name}}}`);
      return String(vars[name]);
    });
    if (rendered.includes('{{') || rendered.includes('}}')) throw new Error(`template: malformed placeholder in: ${line.trim()}`);
    out.push(rendered);
  }
  if (open.length) throw new Error(`template: block {{#${open.at(-1).name}}} is never closed`);
  return out.join('');
}

/** 86Box's hard-disk parameter string: sectors, heads, cylinders, write-protect, bus. */
export function geometryParams({ cylinders, heads = 16, sectorsPerTrack = 63 }) {
  return `${sectorsPerTrack}, ${heads}, ${cylinders}, 0, ide`;
}

const FORBIDDEN_KEYS = ['uuid', 'cpu_override'];

/**
 * Renders a profile's template to cfg text. Disk and floppy paths are relative to the VM folder.
 * Normal mode attaches C: and D:, plus the floppy named by `floppy` (in the VM's `floppy/` folder)
 * as A: when one is given. Install mode (`install: true`) attaches C: and that floppy, which is
 * then required, and no D:, so DOS Setup can't partition the wrong disk.
 */
export function renderVmCfg(profile, templateText, { install = false, floppy } = {}) {
  const vars = { C_IMG: 'c.img', C_PARAMS: geometryParams(profile.c.geometry) };
  if (install) {
    if (!floppy) throw new Error('install mode needs a first floppy');
  } else {
    vars.D_IMG = 'd.img';
    vars.D_PARAMS = geometryParams(profile.d.geometry);
  }
  if (floppy) vars.FDD1_FN = `floppy/${floppy}`;
  const text = renderTemplate(templateText, vars);
  for (const line of text.split(/\r?\n/)) {
    const key = /^\s*([A-Za-z0-9_]+)\s*=/.exec(line)?.[1];
    if (key && FORBIDDEN_KEYS.includes(key)) {
      throw new Error(`the template sets '${key}', which makes 86Box open a dialog`);
    }
  }
  return text;
}

/** The isolated 86Box global config: no VM manager, no exit or reset prompts. */
export function globalCfgText() {
  return ['[Emulator]', 'vmm_disabled = 1', 'confirm_exit = 0', 'confirm_reset = 0', 'confirm_save = 0', ''].join('\n');
}
