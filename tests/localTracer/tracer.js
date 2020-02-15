const Span = require("./span");

module.exports = class Tracer {
  constructor() {
    this._newSpanId = 0;
    /** @type {Map<number, Span>} */
    this.spans = new Map();
  }

  /**
   * @param {string} name
   * @param {import("opentracing").SpanOptions} [options]
   * @returns {Span}
   */
  startSpan(name, options) {
    const span = new Span(this._newSpanId++, name);

    if (options) {
      if (options.tags) Object.entries(options.tags).forEach(([key, value]) => span.setTag(key, value));

      if (options.childOf) options.childOf.withChildSpans(span);
    }

    this.spans.set(span._id, span);
    return span;
  }

  /**
   * @param {Span} span
   * @param {string} format
   * @param {any} carrier
   * @returns {void}
   */
  inject(span, format, carrier) {
    carrier["span-id"] = String(span._id);
  }

  /**
   * @param {string} format
   * @param {any} carrier
   * @returns {Span}
   */
  extract(format, carrier) {
    return this.spans.get(Number(carrier["span-id"]));
  }

  clear() {
    this._newSpanId = 0;
    this.spans.clear();
  }
};
