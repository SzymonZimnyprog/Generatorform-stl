/**
 * Budowanie paneli sterowania narzędzi. Każda kontrolka zwraca obiekt
 * { el, get value(), set value(v) } i przyjmuje opcjonalny `onChange`.
 */

/** Zwraca elementy układu strony narzędzia (patrz szkielet HTML). */
export function getToolLayout() {
  const controls = document.getElementById('controls')
  const viewerEl = document.getElementById('viewer')
  const statusEl = document.getElementById('status')
  return { controls, viewerEl, statusEl }
}

/** Sekcja panelu z nagłówkiem. */
export function group(parent, title, { open = true } = {}) {
  const details = document.createElement('details')
  details.className = 'ctl-group'
  details.open = open
  const summary = document.createElement('summary')
  summary.textContent = title
  details.appendChild(summary)
  const body = document.createElement('div')
  body.className = 'ctl-group-body'
  details.appendChild(body)
  parent.appendChild(details)
  return body
}

function row(parent, label) {
  const wrap = document.createElement('label')
  wrap.className = 'ctl'
  if (label) {
    const span = document.createElement('span')
    span.className = 'ctl-label'
    span.textContent = label
    wrap.appendChild(span)
  }
  parent.appendChild(wrap)
  return wrap
}

/** Suwak z polem liczbowym. */
export function slider(parent, { label, min, max, step = 1, value, unit = 'mm', onChange }) {
  const wrap = row(parent, label)
  const line = document.createElement('div')
  line.className = 'ctl-slider'
  const range = document.createElement('input')
  range.type = 'range'
  range.min = min
  range.max = max
  range.step = step
  range.value = value
  const num = document.createElement('input')
  num.type = 'number'
  num.min = min
  num.max = max
  num.step = step
  num.value = value
  const unitEl = document.createElement('span')
  unitEl.className = 'ctl-unit'
  unitEl.textContent = unit
  line.append(range, num, unitEl)
  wrap.appendChild(line)
  const api = {
    el: wrap,
    get value() { return parseFloat(range.value) },
    set value(v) { range.value = v; num.value = v },
  }
  range.addEventListener('input', () => { num.value = range.value; onChange?.(api.value) })
  num.addEventListener('change', () => {
    const v = Math.min(max, Math.max(min, parseFloat(num.value) || min))
    num.value = v; range.value = v; onChange?.(v)
  })
  return api
}

/** Lista rozwijana. options: [{value, label}] */
export function select(parent, { label, options, value, onChange }) {
  const wrap = row(parent, label)
  const sel = document.createElement('select')
  for (const o of options) {
    const opt = document.createElement('option')
    opt.value = o.value
    opt.textContent = o.label
    sel.appendChild(opt)
  }
  if (value !== undefined) sel.value = value
  sel.addEventListener('change', () => onChange?.(sel.value))
  wrap.appendChild(sel)
  return {
    el: wrap,
    get value() { return sel.value },
    set value(v) { sel.value = v },
  }
}

/** Pole tekstowe (jednolinijkowe lub textarea). */
export function textInput(parent, { label, value = '', placeholder = '', multiline = false, onChange }) {
  const wrap = row(parent, label)
  const input = document.createElement(multiline ? 'textarea' : 'input')
  if (!multiline) input.type = 'text'
  else input.rows = 3
  input.value = value
  input.placeholder = placeholder
  input.addEventListener('input', () => onChange?.(input.value))
  wrap.appendChild(input)
  return {
    el: wrap,
    get value() { return input.value },
    set value(v) { input.value = v },
  }
}

/** Przełącznik. */
export function checkbox(parent, { label, value = false, onChange }) {
  const wrap = document.createElement('label')
  wrap.className = 'ctl ctl-check'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = value
  const span = document.createElement('span')
  span.textContent = label
  wrap.append(input, span)
  parent.appendChild(wrap)
  input.addEventListener('change', () => onChange?.(input.checked))
  return {
    el: wrap,
    get value() { return input.checked },
    set value(v) { input.checked = v },
  }
}

/** Przycisk. kind: 'primary' | 'ghost' */
export function button(parent, { label, kind = 'ghost', onClick }) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = `btn btn-${kind}`
  btn.textContent = label
  btn.addEventListener('click', () => onClick?.())
  parent.appendChild(btn)
  return btn
}

/** Strefa wczytywania pliku (klik + przeciągnij i upuść). */
export function fileDrop(parent, { label, accept, hint = '', onFile }) {
  const zone = document.createElement('div')
  zone.className = 'dropzone'
  zone.innerHTML = `<strong>${label}</strong><small>${hint || 'kliknij lub przeciągnij plik'}</small><em class="dropzone-file"></em>`
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.hidden = true
  zone.appendChild(input)
  const fileEl = zone.querySelector('.dropzone-file')
  const handle = (file) => {
    if (!file) return
    fileEl.textContent = file.name
    onFile?.(file)
  }
  zone.addEventListener('click', () => input.click())
  input.addEventListener('change', () => handle(input.files[0]))
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag') })
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'))
  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    zone.classList.remove('drag')
    handle(e.dataTransfer.files[0])
  })
  parent.appendChild(zone)
  return zone
}

/** Pasek statusu nad podglądem. kind: 'info' | 'busy' | 'error' | 'ok' */
export function makeStatus(statusEl) {
  return function status(msg, kind = 'info') {
    if (!msg) { statusEl.className = 'status'; statusEl.textContent = ''; return }
    statusEl.className = `status status-${kind} visible`
    statusEl.innerHTML = kind === 'busy' ? `<span class="spin"></span>${msg}` : msg
  }
}

/** Debounce — do przeliczania modelu po zmianie suwaka. */
export function debounce(fn, ms = 250) {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

/** Odkłada ciężkie liczenie o jedną klatkę, żeby status zdążył się narysować. */
export function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
}
