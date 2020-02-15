module.exports = class Span {
  /**
   * @param {number} id
   * @param {string} name
   */
  constructor(id, name) {
    this._id = id;
    this.name = name;
    this.isFinished = false;

    /** @type {{[key: string]: any}} */
    this.tags = {};
    /** @type {Array<{[key: string]: any}>} */
    this.logs = [];

    /** @type {Span} */
    this.parentSpan = null;
    /** @type {Array<Span>} */
    this.childSpans = [];
  }

  /**
   * @param {string} key
   * @param {any} value
   */
  setTag(key, value) {
    this.tags[key] = value;
    return this;
  }

  /**
   * @param {{[key: string]: any}} keyValuePairs
   */
  log(keyValuePairs) {
    this.logs.push(keyValuePairs);
    return this;
  }

  /**
   * @returns {Span}
   */
  finish() {
    this.isFinished = true;
    return this;
  }

  /**
   * @param  {...Span} childSpans
   * @returns {Span}
   */
  withChildSpans(...childSpans) {
    this.childSpans.push(...childSpans);
    childSpans.forEach(span => {
      span.parentSpan = this;
    });

    return this;
  }
};
