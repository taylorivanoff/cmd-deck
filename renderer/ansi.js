(() => {
  const BASIC = [
    '#0c0c0c', '#cd3131', '#0dbc79', '#e5e510',
    '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
    '#666666', '#f14c4c', '#23d18b', '#f5f543',
    '#3b8eea', '#d670d6', '#29b8db', '#e5e5e5'
  ];

  const FG = {
    30: BASIC[0], 31: BASIC[1], 32: BASIC[2], 33: BASIC[3],
    34: BASIC[4], 35: BASIC[5], 36: BASIC[6], 37: BASIC[7],
    90: BASIC[8], 91: BASIC[9], 92: BASIC[10], 93: BASIC[11],
    94: BASIC[12], 95: BASIC[13], 96: BASIC[14], 97: BASIC[15]
  };

  const BG = {
    40: BASIC[0], 41: BASIC[1], 42: BASIC[2], 43: BASIC[3],
    44: BASIC[4], 45: BASIC[5], 46: BASIC[6], 47: BASIC[7],
    100: BASIC[8], 101: BASIC[9], 102: BASIC[10], 103: BASIC[11],
    104: BASIC[12], 105: BASIC[13], 106: BASIC[14], 107: BASIC[15]
  };

  function color256(n) {
    const i = Number(n);
    if (!Number.isFinite(i) || i < 0) return null;
    if (i < 16) return BASIC[i];
    if (i < 232) {
      const v = i - 16;
      const r = Math.floor(v / 36);
      const g = Math.floor((v % 36) / 6);
      const b = v % 6;
      const c = [0, 95, 135, 175, 215, 255];
      return `rgb(${c[r]}, ${c[g]}, ${c[b]})`;
    }
    if (i < 256) {
      const gray = 8 + (i - 232) * 10;
      return `rgb(${gray}, ${gray}, ${gray})`;
    }
    return null;
  }

  function defaultStyle() {
    return {
      fg: null,
      bg: null,
      bold: false,
      dim: false,
      italic: false,
      underline: false,
      inverse: false
    };
  }

  function cloneStyle(style) {
    return { ...style };
  }

  function stylesEqual(a, b) {
    return a.fg === b.fg
      && a.bg === b.bg
      && a.bold === b.bold
      && a.dim === b.dim
      && a.italic === b.italic
      && a.underline === b.underline
      && a.inverse === b.inverse;
  }

  function applySgr(style, params) {
    if (!params.length) params = [0];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (p === 0) {
        Object.assign(style, defaultStyle());
      } else if (p === 1) style.bold = true;
      else if (p === 2) style.dim = true;
      else if (p === 3) style.italic = true;
      else if (p === 4) style.underline = true;
      else if (p === 7) style.inverse = true;
      else if (p === 22) { style.bold = false; style.dim = false; }
      else if (p === 23) style.italic = false;
      else if (p === 24) style.underline = false;
      else if (p === 27) style.inverse = false;
      else if (p === 39) style.fg = null;
      else if (p === 49) style.bg = null;
      else if (FG[p]) style.fg = FG[p];
      else if (BG[p]) style.bg = BG[p];
      else if (p === 38 || p === 48) {
        const isFg = p === 38;
        const mode = params[i + 1];
        if (mode === 5 && params[i + 2] != null) {
          const color = color256(params[i + 2]);
          if (isFg) style.fg = color;
          else style.bg = color;
          i += 2;
        } else if (mode === 2 && params[i + 4] != null) {
          const color = `rgb(${params[i + 2]}, ${params[i + 3]}, ${params[i + 4]})`;
          if (isFg) style.fg = color;
          else style.bg = color;
          i += 4;
        } else {
          i += 1;
        }
      }
    }
  }

  function styleToCss(style, fallbackFg) {
    let fg = style.fg || fallbackFg || null;
    let bg = style.bg || null;
    if (style.inverse) {
      const nextFg = bg || '#0c0c0c';
      const nextBg = fg || '#e5e5e5';
      fg = nextFg;
      bg = nextBg;
    }
    const css = [];
    if (fg) css.push(`color:${fg}`);
    if (bg) css.push(`background:${bg}`);
    return css.join(';');
  }

  function styleClassName(style, streamClass) {
    const parts = [];
    if (streamClass) parts.push(streamClass);
    if (style.bold) parts.push('term-bold');
    if (style.dim) parts.push('term-dim');
    if (style.italic) parts.push('term-italic');
    if (style.underline) parts.push('term-underline');
    return parts.join(' ');
  }

  class AnsiTerminal {
    constructor(root) {
      this.root = root;
      this.pending = '';
      this.style = defaultStyle();
      this.cells = [];
      this.col = 0;
      this.streamClass = '';
      this.fallbackFg = null;
      this._lineEl = null;
    }

    clear() {
      this.root.textContent = '';
      this.pending = '';
      this.style = defaultStyle();
      this.cells = [];
      this.col = 0;
      this.streamClass = '';
      this.fallbackFg = null;
      this._lineEl = null;
    }

    write(text, options = {}) {
      if (text == null || text === '') return;
      this.streamClass = options.className || '';
      this.fallbackFg = options.fallbackFg || null;

      let input = this.pending + String(text);
      this.pending = '';
      let i = 0;

      while (i < input.length) {
        const ch = input[i];

        if (ch === '\x1b') {
          const rest = input.slice(i);
          const consumed = this.#consumeEscape(rest);
          if (consumed == null) {
            this.pending = rest;
            break;
          }
          i += consumed;
          continue;
        }

        if (ch === '\r') {
          this.col = 0;
          i += 1;
          continue;
        }

        if (ch === '\n') {
          this.#flushLine();
          i += 1;
          continue;
        }

        if (ch === '\b') {
          this.col = Math.max(0, this.col - 1);
          i += 1;
          continue;
        }

        if (ch === '\t') {
          const spaces = 8 - (this.col % 8);
          for (let s = 0; s < spaces; s++) this.#put(' ', cloneStyle(this.style));
          i += 1;
          continue;
        }

        if (ch === '\x07') {
          i += 1;
          continue;
        }

        this.#put(ch, cloneStyle(this.style));
        i += 1;
      }

      this.#renderCurrentLine();
      this.root.scrollTop = this.root.scrollHeight;
    }

    #put(ch, style) {
      this.cells[this.col] = { ch, style, streamClass: this.streamClass, fallbackFg: this.fallbackFg };
      this.col += 1;
    }

    #flushLine() {
      this.#renderCurrentLine();
      this.cells = [];
      this.col = 0;
      // Start a new line element so consecutive newlines produce blank rows.
      const line = document.createElement('div');
      line.className = 'term-line';
      this.root.appendChild(line);
      this._lineEl = line;
    }

    #renderCurrentLine() {
      if (!this._lineEl || !this._lineEl.isConnected) {
        this._lineEl = document.createElement('div');
        this._lineEl.className = 'term-line';
        this.root.appendChild(this._lineEl);
      }

      const frag = document.createDocumentFragment();
      if (!this.cells.length) {
        frag.appendChild(document.createTextNode(''));
      } else {
        let run = null;
        for (let i = 0; i < this.cells.length; i++) {
          const cell = this.cells[i] || {
            ch: ' ',
            style: defaultStyle(),
            streamClass: '',
            fallbackFg: null
          };
          if (
            run
            && stylesEqual(run.style, cell.style)
            && run.streamClass === cell.streamClass
            && run.fallbackFg === cell.fallbackFg
          ) {
            run.text += cell.ch;
            continue;
          }
          if (run) frag.appendChild(this.#spanFor(run));
          run = {
            text: cell.ch,
            style: cell.style,
            streamClass: cell.streamClass,
            fallbackFg: cell.fallbackFg
          };
        }
        if (run) frag.appendChild(this.#spanFor(run));
      }

      this._lineEl.replaceChildren(frag);
    }

    #spanFor(run) {
      const span = document.createElement('span');
      const className = styleClassName(run.style, run.streamClass);
      if (className) span.className = className;
      const css = styleToCss(run.style, run.fallbackFg);
      if (css) span.style.cssText = css;
      span.textContent = run.text;
      return span;
    }

    #consumeEscape(rest) {
      if (rest.length < 2) return null;

      // OSC: ESC ] ... BEL or ESC ]
      if (rest[1] === ']') {
        const bel = rest.indexOf('\x07');
        const st = rest.indexOf('\x1b\\');
        let end = -1;
        let size = 0;
        if (bel !== -1 && (st === -1 || bel < st)) {
          end = bel;
          size = bel + 1;
        } else if (st !== -1) {
          end = st;
          size = st + 2;
        }
        if (end === -1) return null;
        return size;
      }

      // Character set / misc one-byte: ESC ( B, ESC ) 0, ESC =, ESC >
      if ("()#*+%".includes(rest[1])) {
        if (rest.length < 3) return null;
        return 3;
      }
      if (rest[1] === '=' || rest[1] === '>') return 2;

      // CSI: ESC [ ... cmd
      if (rest[1] === '[') {
        const match = rest.match(/^\x1b\[[0-9;?]*[A-Za-z@`{}~]/);
        // Incomplete if we only have ESC[ or params without final byte
        if (!match) {
          if (/^\x1b\[[0-9;?]*$/.test(rest)) return null;
          // Malformed: drop ESC
          return 1;
        }
        const seq = match[0];
        const final = seq[seq.length - 1];
        const body = seq.slice(2, -1);
        this.#handleCsi(body, final);
        return seq.length;
      }

      // Unknown ESC — drop ESC only
      return 1;
    }

    #handleCsi(body, final) {
      const privateMode = body.startsWith('?');
      const paramsText = privateMode ? body.slice(1) : body;
      const params = paramsText
        ? paramsText.split(';').map((p) => {
          const n = parseInt(p, 10);
          return Number.isFinite(n) ? n : 0;
        })
        : [];

      if (final === 'm' && !privateMode) {
        applySgr(this.style, params);
        return;
      }

      // Erase in line: 0/none = cursor to end, 1 = start to cursor, 2 = entire line
      if (final === 'K' && !privateMode) {
        const mode = params[0] || 0;
        if (mode === 2) {
          this.cells = [];
          this.col = 0;
        } else if (mode === 1) {
          for (let i = 0; i < this.col; i++) this.cells[i] = { ch: ' ', style: cloneStyle(this.style), streamClass: this.streamClass, fallbackFg: this.fallbackFg };
        } else {
          this.cells.length = this.col;
        }
        return;
      }

      // Erase display — keep simple: clear all for 2/3
      if (final === 'J' && !privateMode) {
        const mode = params[0] || 0;
        if (mode === 2 || mode === 3) {
          this.root.textContent = '';
          this.cells = [];
          this.col = 0;
          this._lineEl = null;
        }
        return;
      }

      // Cursor horizontal absolute
      if (final === 'G' && !privateMode) {
        this.col = Math.max(0, (params[0] || 1) - 1);
        return;
      }

      // Cursor up/down/forward/back — approximate on current buffer
      if (final === 'A') return;
      if (final === 'B') return;
      if (final === 'C') {
        const n = params[0] || 1;
        for (let k = 0; k < n; k++) {
          if (!this.cells[this.col]) {
            this.#put(' ', cloneStyle(this.style));
          } else {
            this.col += 1;
          }
        }
        return;
      }
      if (final === 'D') {
        this.col = Math.max(0, this.col - (params[0] || 1));
        return;
      }

      // SGR-adjacent / cursor hide etc — ignore private modes and other CSI
    }
  }

  window.AnsiTerminal = AnsiTerminal;
})();
