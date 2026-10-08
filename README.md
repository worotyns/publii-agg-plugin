# agg Analytics for Publii

Adds [agg](https://github.com/worotyns/agg) (cookieless, self-hosted analytics and insights) to a
[Publii](https://getpublii.com) site. Paste your agg server address and the `pk_…` site key, and every page sends
page views; post pages also tell you which articles are actually read.

## What you get

- **Page views, visitors, top pages, referrers, browsers and devices.** Sent by the agg SDK on every page.
- **Most read articles and readers per section.** On post pages the plugin sends
  `article_read` with `{ article: slug, title, section: main tag, author }` once the reader stayed long enough (time
  counted only while the tab is visible) or scrolled far enough. Each threshold is configurable, and each page view
  counts at most one read.
- **Outbound clicks** (optional): `outbound_click` with `{ host, url }` when a visitor follows a link to another site.
- **No cookies.** agg keeps a random visitor id in `localStorage` and strips obvious personal data on the server. If
  you want consent anyway, the plugin can wait for the Publii Cookie Banner.
- **No tracking in Preview Mode**, unless you enable it to check the setup.

## Setup

1. **In agg**: create a site and pick the **Blog / publisher** preset (it includes Website analytics plus the
   *Most read articles* and *Readers per section* aggregates fed by `article_read`). Copy the site key from
   **Settings → Install**.
2. **Install the plugin** in Publii: **Tools & Plugins → Install plugin** and pick `aggAnalytics.zip` (build it
   with `./build.sh`, which writes `dist/aggAnalytics.zip`). You can also copy this folder to
   `Documents/Publii/plugins/aggAnalytics`.
3. **Enable it for your site** (Tools & Plugins → agg Analytics), then fill in:
   - **agg server address**: e.g. `https://agg.example.com` (`https://` is added when missing; a sub-path such as
     `https://example.com/agg` works too),
   - **Site key**: `pk_…`.
4. **Sync the site.** Within seconds the first `page_view` shows up under **Events** in agg.

## Options

| Option | Default | |
|---|---|---|
| Track article reads | on | `article_read` on post pages. Needs the theme to output the footer custom code (`{{{@footerCustomCode}}}`); all official themes do. |
| Read after (seconds) | 30 | Visible time on the page. 0 disables the rule. |
| Read after scrolling (%) | 60 | Scroll depth, checked on scroll. 0 disables the rule. With both at 0 every post view counts as a read. |
| Track outbound link clicks | off | `outbound_click` with `{ host, url }`. |
| Send events in Preview Mode | off | Only for testing. |
| Wait for consent from the Publii Cookie Banner | off | Loads agg only after the visitor accepts the given Cookie Group (e.g. `analytics`). Has no effect while the Cookie Banner is disabled in Site Settings. |

### Useful aggregates for outbound clicks

Aggregates → New aggregate: event `outbound_click`, operation *count*, group by `props.host`: "where do my readers
go".

## How it works

The plugin adds one inline script to `<head>` (Publii's `publiiHead` insertion) that queues
`agg.init({ endpoint, site })` and loads `https://<your server>/agg.js` asynchronously. It does not use the
`data-site` attribute, because the Publii Cookie Banner re-creates blocked scripts from their `src` and text only.
Post events go into the footer custom code (`customFooterCode` insertion), which also receives the rendered post.
Calls made before the SDK has loaded are queued and sent once it starts.

When the Cookie Banner integration is on, both scripts get `type="gdpr-blocker/<group>"` and also call
`agg.consent({ analytics: true })`, so sites configured in agg with *Require consent* work as well. If a visitor
withdraws consent, the Cookie Banner reloads the page and agg no longer loads.

## Development

```sh
node --test          # runs the generated snippets with the real agg SDK (fixtures/agg.js)
./build.sh           # tests, then dist/aggAnalytics.zip
```

`fixtures/agg.js` is a copy of `web/sdk/agg.js` from the agg repo, used only by the tests (the plugin loads the SDK
from your agg server). Refresh it when the SDK changes.

Tested against Publii 0.47 (`minimumPubliiVersion` 0.46.0).

## Licence

MIT, see [LICENSE](LICENSE). agg itself is licensed separately (Elastic License 2.0). Author: Mateusz Worotyński <worotyns@icloud.com>.
