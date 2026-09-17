// interceptor-main.js — runs in MAIN world
// Proxies fetch and XHR to capture Banner searchResults JSON passively.
(function () {
  const TARGET = "/ssb/searchResults/searchResults";
  function notify(payload) {
    try {
      window.postMessage({ type: "SC_CAPTURE", payload }, "*");
    } catch (e) {}
  }

  // fetch proxy
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (url.includes(TARGET)) {
        res.clone().json().then((j) => notify(j)).catch(()=>{});
      }
    } catch (e) {}
    return res;
  };

  // XHR proxy
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._scUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        if (this._scUrl && this._scUrl.includes(TARGET) && this.responseText) {
          const j = JSON.parse(this.responseText);
          notify(j);
        }
      } catch (e) {}
    });
    return origSend.apply(this, args);
  };
})();
