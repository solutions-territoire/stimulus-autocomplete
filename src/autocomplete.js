import { Controller } from "@hotwired/stimulus"

const optionSelector = "[role='option']:not([aria-disabled])"
const activeSelector = "[aria-selected='true']"

export default class Autocomplete extends Controller {
  static targets = ["input", "hidden", "results"]
  static classes = ["selected"]
  static values = {
    ready:           Boolean,
    requireMatch:    { type: Boolean, default: true },
    revealOnClick:   { type: Boolean, default: false },
    revealOnFocus:   { type: Boolean, default: false },
    revealOnKeyDown: { type: Boolean, default: true },
    submitOnEnter:   { type: Boolean, default: false },
    url:             String,
    minLength:       { type: Number, default: 1 },
    delay:           { type: Number, default: 300 },
    queryParam:      { type: String, default: "q" },
  }

  static uniqOptionId = 0

  connect() {
    this.close()
    this.inputTarget.setAttribute("autocomplete", "off")
    this.inputTarget.setAttribute("spellcheck", "false")

    this.mouseDown = false

    this.onInputChange = debounce(this.onInputChange, this.delayValue)

    this.inputTarget.addEventListener("keydown", this.onKeydown)
    this.inputTarget.addEventListener("focusin", this.onInputFocus)
    this.inputTarget.addEventListener("blur", this.onInputBlur)
    this.inputTarget.addEventListener("input", this.onInputChange)
    this.inputTarget.addEventListener("click", this.onInputClick)
    this.resultsTarget.addEventListener("mousedown", this.onResultsMouseDown)
    this.resultsTarget.addEventListener("click", this.onResultsClick)

    if (this.inputTarget.hasAttribute("autofocus")) {
      this.inputTarget.focus()
    }

    this.readyValue = true
  }

  disconnect() {
    if (this.hasInputTarget) {
      this.inputTarget.removeEventListener("keydown", this.onKeydown)
      this.inputTarget.removeEventListener("focusin", this.onInputFocus)
      this.inputTarget.removeEventListener("blur", this.onInputBlur)
      this.inputTarget.removeEventListener("input", this.onInputChange)
      this.inputTarget.removeEventListener("click", this.onInputClick)
    }

    if (this.hasResultsTarget) {
      this.resultsTarget.removeEventListener("mousedown", this.onResultsMouseDown)
      this.resultsTarget.removeEventListener("click", this.onResultsClick)
    }
  }

  sibling(next) {
    const options = this.options
    const selected = this.selectedOption
    const index = options.indexOf(selected)
    const sibling = next ? options[index + 1] : options[index - 1]
    const def = next ? options[0] : options[options.length - 1]
    return sibling || def
  }

  select(target) {
    const previouslySelected = this.selectedOption
    if (previouslySelected) {
      previouslySelected.removeAttribute("aria-selected")
      previouslySelected.classList.remove(...this.selectedClassesOrDefault)
    }

    target.setAttribute("aria-selected", "true")
    target.classList.add(...this.selectedClassesOrDefault)
    this.inputTarget.setAttribute("aria-activedescendant", target.id)
    target.scrollIntoView({ behavior: "auto", block: "nearest" })
  }

  onKeydown = (event) => {
    const handler = this[`on${event.key}Keydown`]
    if (handler) handler(event)
  }

  onEscapeKeydown = (event) => {
    if (!this.resultsShown) return

    this.hideAndRemoveOptions()
    event.stopPropagation()
    event.preventDefault()
  }

  onArrowDownKeydown = (event) => {
    if (this.resultsShown) {
      const item = this.sibling(true)
      if (item) this.select(item)
      event.preventDefault()
    } else if (this.revealOnKeyDownValue) {
      this.fetchInput()
    }
  }

  onArrowUpKeydown = (event) => {
    const item = this.sibling(false)
    if (item) this.select(item)
    event.preventDefault()
  }

  onTabKeydown = (event) => {
    const selected = this.selectedOption
    if (selected) this.commit(selected)
  }

  onEnterKeydown = (event) => {
    const selected       = this.selectedOption
    const value          = this.inputTarget.value
    const preventDefault = !this.submitOnEnterValue

    if (selected && this.resultsShown) {
      this.commit(selected)
      if (preventDefault) event.preventDefault()
    } else if (!selected && !this.requireMatchValue && value) {
      this.commitValue(value)
      if (preventDefault) event.preventDefault()
    }

    event.preventDefault()
  }

  onInputFocus = () => {
    if (this.hiddenTarget.value) return;
    if (this.revealOnFocusValue) this.fetchInput()
  }

  onInputBlur = () => {
    if (this.mouseDown) return
    this.close()
  }

  onInputClick = () => {
    if (this.hiddenTarget.value) return;
    if (this.revealOnClickValue) this.fetchInput()
  }

  commit(selected) {
    if (selected.getAttribute("aria-disabled") === "true") return

    if (selected instanceof HTMLAnchorElement) {
      selected.click()
      this.close()
      return
    }

    const textValue = selected.getAttribute("data-autocomplete-label") || selected.textContent.trim()
    const value = selected.getAttribute("data-autocomplete-value") || textValue
    this.inputTarget.value = textValue

    this.commitValue(value, { textValue: textValue, selected: selected })
  }

  commitValue(value, changeDetail) {
    if (this.hasHiddenTarget) {
      this.hiddenTarget.value = value
      this.hiddenTarget.dispatchEvent(new Event("input"))
      this.hiddenTarget.dispatchEvent(new Event("change"))
    } else {
      this.inputTarget.value = value
    }

    this.inputTarget.focus()
    this.hideAndRemoveOptions()

    changeDetail ||= {}
    changeDetail["value"] = value

    this.element.dispatchEvent(
      new CustomEvent("autocomplete.change", {
        bubbles: true,
        detail: changeDetail
      })
    )
  }

  clear() {
    this.inputTarget.value = ""
    if (this.hasHiddenTarget) this.hiddenTarget.value = ""
  }

  onResultsClick = (event) => {
    if (!(event.target instanceof Element)) return
    const selected = event.target.closest(optionSelector)
    if (selected) this.commit(selected)
  }

  onResultsMouseDown = () => {
    this.mouseDown = true
    this.resultsTarget.addEventListener("mouseup", () => {
      this.mouseDown = false
    }, { once: true })
  }

  onInputChange = () => {
    if (this.hasHiddenTarget) this.hiddenTarget.value = ""

    this.fetchInput() || this.hideAndRemoveOptions()
  }

  identifyOptions() {
    const prefix = this.resultsTarget.id || "stimulus-autocomplete"
    const optionsWithoutId = this.resultsTarget.querySelectorAll(`${optionSelector}:not([id])`)
    optionsWithoutId.forEach(el => el.id = `${prefix}-option-${Autocomplete.uniqOptionId++}`)
  }

  hideAndRemoveOptions() {
    this.close()
    this.resultsTarget.innerHTML = null
  }

  fetchInput () {
    const query = this.inputTarget.value.trim()
    const length = query ? query.length : 0

    if (length >= this.minLengthValue) {
      this.fetchResults(query)
      return true
    } else {
      return false
    }
  }

  fetchResults = async (query) => {
    if (!this.hasUrlValue) return

    const url = this.buildURL(query)
    try {
      this.element.dispatchEvent(new CustomEvent("loadstart"))
      const html = await this.doFetch(url)
      this.replaceResults(html)
      this.element.dispatchEvent(new CustomEvent("load"))
      this.element.dispatchEvent(new CustomEvent("loadend"))
    } catch(error) {
      this.element.dispatchEvent(new CustomEvent("error"))
      this.element.dispatchEvent(new CustomEvent("loadend"))
      throw error
    }
  }

  buildURL(query) {
    const url = new URL(this.urlValue, window.location.href)
    const params = new URLSearchParams(url.search.slice(1))
    params.append(this.queryParamValue, query)
    url.search = params.toString()

    return url.toString()
  }

  doFetch = async (url) => {
    const response = await fetch(url, this.optionsForFetch())

    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`)
    }

    const html = await response.text()
    return html
  }

  replaceResults(html) {
    this.resultsTarget.innerHTML = html
    this.identifyOptions()

    if (this.resultsTarget.children.length) {
      this.open()

      const options = this.options
      if (options && options.length) {
        this.select(options[0])
      }
    } else {
      this.close()
    }
  }

  open() {
    if (this.resultsShown) return

    this.resultsShown = true
    this.element.setAttribute("aria-expanded", "true")
    this.element.dispatchEvent(
      new CustomEvent("toggle", {
        detail: { action: "open", inputTarget: this.inputTarget, resultsTarget: this.resultsTarget }
      })
    )
  }

  close() {
    if (!this.resultsShown) return

    this.resultsShown = false
    this.inputTarget.removeAttribute("aria-activedescendant")
    this.element.setAttribute("aria-expanded", "false")
    this.element.dispatchEvent(
      new CustomEvent("toggle", {
        detail: { action: "close", inputTarget: this.inputTarget, resultsTarget: this.resultsTarget }
      })
    )
  }

  get resultsShown() {
    return !this.resultsTarget.hidden
  }

  set resultsShown(value) {
    this.resultsTarget.hidden = !value
  }

  get options() {
    return Array.from(this.resultsTarget.querySelectorAll(optionSelector))
  }

  get selectedOption() {
    return this.resultsTarget.querySelector(activeSelector)
  }

  get selectedClassesOrDefault() {
    return this.hasSelectedClass ? this.selectedClasses : ["active"]
  }

  optionsForFetch () {
    return {
      headers: {
        "Accept-Variant": "Autocomplete",
        "X-Requested-With": "XMLHttpRequest"
      }
    }
  }
}

const debounce = (fn, delay = 10) => {
  let timeoutId = null

  return (...args) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(fn, delay)
  }
}

export { Autocomplete }
