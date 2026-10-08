// agg Analytics for Publii: loads the agg browser SDK and sends blog events.
class AggAnalytics {
  constructor(API, name, config) {
    this.API = API;
    this.name = name;
    this.config = config;
  }

  addInsertions() {
    // publiiHead is output by every theme; customFooterCode also gets the post being rendered.
    this.API.addInsertion('publiiHead', this.addLoader, 1, this);
    this.API.addInsertion('customFooterCode', this.addPageEvents, 1, this);
  }

  // host returns the server origin (and path, if agg runs under one) without a trailing slash, or '' if invalid.
  host() {
    let host = String(this.config.host || '').trim();

    if (host && !/^[a-z][a-z0-9+.-]*:/i.test(host)) {
      host = 'https://' + host;
    }

    try {
      const url = new URL(host);

      if (!/^https?:$/.test(url.protocol) || !url.hostname) {
        return '';
      }

      return url.origin + url.pathname.replace(/\/+$/, '');
    } catch (e) {
      return '';
    }
  }

  siteKey() {
    const key = String(this.config.siteKey || '').trim();
    return /^pk_[A-Za-z0-9_-]+$/.test(key) ? key : '';
  }

  enabled(rendererInstance) {
    return (!rendererInstance.previewMode || this.config.previewMode) && this.host() !== '' && this.siteKey() !== '';
  }

  // scriptType blocks the script until the visitor consents, when the Publii Cookie Banner is used.
  scriptType(rendererInstance) {
    const gdpr = rendererInstance.siteConfig.advanced && rendererInstance.siteConfig.advanced.gdpr;
    const group = String(this.config.cookieBannerGroup || '').trim();

    if (this.config.cookieBannerIntegration && gdpr && gdpr.enabled && group) {
      return 'gdpr-blocker/' + group.replace(/[^A-Za-z0-9_-]/g, '');
    }

    return 'text/javascript';
  }

  consented(rendererInstance) {
    return this.scriptType(rendererInstance) !== 'text/javascript';
  }

  // One inline script: the Cookie Banner re-creates blocked scripts from their src and text only,
  // so the site key cannot be passed as a data-site attribute.
  addLoader(rendererInstance) {
    if (!this.enabled(rendererInstance)) {
      return '';
    }

    const opts = json({ endpoint: this.host(), site: this.siteKey() });
    const src = json(this.host() + '/agg.js');
    const consent = this.consented(rendererInstance) ? "a.q.push(['consent',{analytics:true}]);" : '';

    return `<script type="${this.scriptType(rendererInstance)}">(function(w,d){` +
      `if(w.agg&&w.agg._loaded)return;` +
      `var a=w.agg=w.agg||{q:[]};a.q=a.q||[];a.q.unshift(['init',${opts}]);${consent}` +
      `var s=d.createElement('script');s.async=true;s.src=${src};d.head.appendChild(s);` +
      `})(window,document);</script>`;
  }

  addPageEvents(rendererInstance, context) {
    if (!this.enabled(rendererInstance)) {
      return '';
    }

    let code = '';
    const post = context && context.post;

    if (this.config.trackArticles && post && post.slug) {
      code += this.articleRead(post);
    }

    if (this.config.trackOutbound) {
      code += OUTBOUND;
    }

    if (!code) {
      return '';
    }

    return `<script type="${this.scriptType(rendererInstance)}">(function(w,d){` + TRACK + code + `})(window,document);</script>`;
  }

  articleRead(post) {
    const props = { article: post.slug, title: post.title || '' };

    if (post.mainTag && post.mainTag.name) {
      props.section = post.mainTag.name;
    }

    if (post.author && post.author.name) {
      props.author = post.author.name;
    }

    const seconds = toInt(this.config.readSeconds, 30);
    const scroll = toInt(this.config.readScroll, 60);

    // Time is counted only while the tab is visible; scroll depth only after the reader scrolls,
    // so a short post that fits the screen still needs the time rule.
    return `(function(props,secs,pct){var seen=0,last=Date.now(),done=false,timer;` +
      `function read(){if(done)return;done=true;clearInterval(timer);w.removeEventListener('scroll',onScroll);track('article_read',props);}` +
      `function onScroll(){var h=d.documentElement.scrollHeight;if(h&&(w.scrollY+w.innerHeight)/h*100>=pct)read();}` +
      `if(!secs&&!pct)return read();` +
      `if(secs)timer=setInterval(function(){var n=Date.now();if(d.visibilityState!=='hidden')seen+=n-last;last=n;if(seen>=secs*1000)read();},1000);` +
      `if(pct)w.addEventListener('scroll',onScroll,{passive:true});` +
      `})(${json(props)},${seconds},${scroll});`;
  }
}

// track calls agg.track, or queues the call until the SDK has loaded.
const TRACK = `function track(n,p){var a=w.agg;if(a&&a.track)a.track(n,p);else{a=w.agg=a||{q:[]};(a.q=a.q||[]).push(['track',n,p]);}}`;

const OUTBOUND = `d.addEventListener('click',function(e){var l=e.target&&e.target.closest&&e.target.closest('a[href]');` +
  `if(!l||!/^https?:$/.test(l.protocol)||l.hostname===w.location.hostname)return;` +
  `track('outbound_click',{host:l.hostname,url:l.href.split('#')[0]});},true);`;

// json encodes a value for an inline script, so a value cannot close the <script> element.
function json(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return isNaN(n) || n < 0 ? fallback : n;
}

module.exports = AggAnalytics;
