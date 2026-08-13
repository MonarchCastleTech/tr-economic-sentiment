const INTEL = {
  data: {},

  async init() {
    try {
      const response = await fetch('data/output.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Data request returned ${response.status}`);
      this.data = await response.json();
      this.render();
    } catch (error) {
      this.renderError(error);
    }
  },

  cleanText(value) {
    if (!value) return '';
    const text = String(value);
    const repairedLegacy = text
      .replaceAll('ý', 'ı')
      .replaceAll('Ý', 'İ')
      .replaceAll('ð', 'ğ')
      .replaceAll('Ð', 'Ğ')
      .replaceAll('þ', 'ş')
      .replaceAll('Þ', 'Ş');
    if (!/[ÃÄÅâ]/.test(repairedLegacy)) return repairedLegacy;
    try {
      const bytes = Uint8Array.from(repairedLegacy, character => character.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return repairedLegacy;
    }
  },

  parseDate(value) {
    if (!value) return null;
    const compact = String(value).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    const date = compact
      ? new Date(`${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`)
      : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  },

  formatDate(value, includeTime = true) {
    const date = this.parseDate(value);
    if (!date) return '—';
    const options = includeTime
      ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'short' };
    return new Intl.DateTimeFormat('en-GB', options).format(date);
  },

  articles() {
    return (this.data.events?.length ? this.data.events : this.data.live_data?.gdelt_articles) || [];
  },

  render() {
    const articles = this.articles();
    document.getElementById('generated-time').textContent = this.formatDate(this.data.meta?.generated);
    document.getElementById('data-mode').textContent = `${this.data.meta?.mode === 'live' ? 'Live' : 'Fallback'} · 6h refresh`;
    document.getElementById('status-message').innerHTML = `<strong>Intelligence status:</strong> ${articles.length} recent economic signals from ${this.uniqueDomains(articles)} public news domains; market context feeds are online.`;
    this.renderStats(articles);
    this.renderSourceTable(articles);
    this.renderEvents(articles);
    this.renderSourceTags();
    this.renderTimeline(articles);
    this.renderSignalMap(articles);
    this.renderAnalysis(articles);
  },

  uniqueDomains(articles) {
    return new Set(articles.map(item => item.domain).filter(Boolean)).size;
  },

  renderStats(articles) {
    const tones = articles.map(item => Number(item.tone)).filter(Number.isFinite);
    const meanTone = tones.length ? tones.reduce((sum, value) => sum + value, 0) / tones.length : 0;
    const sentiment = Math.round(Math.max(0, Math.min(100, 50 + meanTone * 5)));
    const feeds = Object.values(this.data.live_data || {}).filter(value => value && (Array.isArray(value) ? value.length : true)).length;
    const stats = [
      { value: `${sentiment}/100`, label: 'News Tone Index', note: meanTone > 0.2 ? '▲ positive' : meanTone < -0.2 ? '▼ negative' : '● neutral' },
      { value: String(articles.length), label: 'Recent Signals', note: 'GDELT snapshot' },
      { value: String(this.uniqueDomains(articles)), label: 'News Domains', note: 'deduplicated' },
      { value: String(feeds), label: 'Live Data Feeds', note: this.cleanText((this.data.meta?.sources || []).join(' · ')) },
    ];
    const grid = document.getElementById('stat-grid');
    grid.replaceChildren(...stats.map(stat => {
      const card = document.createElement('article');
      card.className = 'stat-card';
      card.innerHTML = `<div class="stat-value">${stat.value}</div><div class="stat-label">${stat.label}</div><div class="stat-delta neutral">${stat.note}</div>`;
      return card;
    }));
  },

  groupSources(articles) {
    const groups = new Map();
    articles.forEach(article => {
      const source = article.domain || article.source || 'Unknown';
      const current = groups.get(source) || { source, count: 0, tones: [] };
      current.count += 1;
      const tone = Number(article.tone);
      if (Number.isFinite(tone)) current.tones.push(tone);
      groups.set(source, current);
    });
    return [...groups.values()].sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  },

  renderSourceTable(articles) {
    const groups = this.groupSources(articles).slice(0, 10);
    const maximum = Math.max(1, ...groups.map(group => group.count));
    const body = document.getElementById('source-rows');
    body.replaceChildren(...groups.map(group => {
      const mean = group.tones.length ? group.tones.reduce((a, b) => a + b, 0) / group.tones.length : 0;
      const row = document.createElement('tr');
      const toneClass = mean > 0.2 ? 'badge-success' : mean < -0.2 ? 'badge-danger' : 'badge-info';
      row.innerHTML = `<td title="${group.source}">${group.source}</td><td>${group.count}</td><td><span class="badge ${toneClass}">${mean.toFixed(1)}</span></td><td><div class="score-bar"><div class="score-bar-fill score-medium" style="width:${group.count / maximum * 100}%"></div></div></td>`;
      return row;
    }));
  },

  renderEvents(articles) {
    const container = document.getElementById('event-list');
    const items = [...articles]
      .sort((a, b) => (this.parseDate(b.seendate)?.getTime() || 0) - (this.parseDate(a.seendate)?.getTime() || 0))
      .slice(0, 8);
    container.replaceChildren(...items.map(item => {
      const article = document.createElement('article');
      article.className = 'list-item';
      const link = document.createElement('a');
      link.className = 'list-item-copy';
      link.href = item.url || '#';
      link.target = '_blank';
      link.rel = 'noreferrer';
      const title = document.createElement('strong');
      title.className = 'list-item-title';
      title.textContent = this.cleanText(item.title || 'Untitled signal');
      const meta = document.createElement('span');
      meta.className = 'list-item-meta';
      meta.textContent = `${item.domain || item.source || 'Public source'} · ${this.formatDate(item.seendate)}`;
      link.append(title, meta);
      article.append(link);
      return article;
    }));
  },

  renderSourceTags() {
    const labels = { gdelt_articles: 'GDELT News', economic_news: 'Economic News', crypto: 'CoinGecko', exchange_rates: 'Exchange Rates' };
    const names = this.data.meta?.sources || Object.keys(this.data.live_data || {});
    const container = document.getElementById('source-tags');
    container.replaceChildren(...names.map(name => {
      const tag = document.createElement('span');
      tag.className = 'tag-source';
      tag.textContent = labels[name] || name.replaceAll('_', ' ');
      return tag;
    }));
  },

  renderTimeline(articles) {
    const buckets = new Map();
    articles.forEach(article => {
      const date = this.parseDate(article.seendate || article.timestamp || article.date);
      if (!date) return;
      date.setUTCMinutes(0, 0, 0);
      const key = date.toISOString();
      buckets.set(key, (buckets.get(key) || 0) + 1);
    });
    const observed = [...buckets].map(([date, value]) => ({ date: new Date(date), value })).sort((a, b) => a.date - b.date);
    if (!observed.length) return this.renderEmpty('timeseries-chart', 'No valid timestamps in this snapshot.');
    const start = new Date(observed[0].date);
    const end = new Date(observed.at(-1).date);
    const series = [];
    for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 3600000) {
      const date = new Date(cursor);
      series.push({ date, value: buckets.get(date.toISOString()) || 0 });
    }
    if (series.length === 1) series.unshift({ date: new Date(start.getTime() - 3600000), value: 0 });
    this.drawLineChart('timeseries-chart', series);
  },

  svgElement(name, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  },

  drawLineChart(containerId, series) {
    const container = document.getElementById(containerId);
    const width = Math.max(container.clientWidth, 520);
    const height = 240;
    const margin = { top: 18, right: 18, bottom: 35, left: 34 };
    const max = Math.max(1, ...series.map(item => item.value));
    const x = index => margin.left + index * (width - margin.left - margin.right) / (series.length - 1);
    const y = value => height - margin.bottom - value / max * (height - margin.top - margin.bottom);
    const svg = this.svgElement('svg', { viewBox: `0 0 ${width} ${height}`, 'aria-label': 'Signals observed by hour' });
    [0, 0.5, 1].forEach(ratio => {
      svg.append(this.svgElement('line', { x1: margin.left, x2: width - margin.right, y1: y(max * ratio), y2: y(max * ratio), class: 'chart-gridline' }));
    });
    const area = `M${x(0)},${height - margin.bottom} ` + series.map((item, index) => `L${x(index)},${y(item.value)}`).join(' ') + ` L${x(series.length - 1)},${height - margin.bottom} Z`;
    svg.append(this.svgElement('path', { d: area, class: 'timeline-area' }));
    const path = series.map((item, index) => `${index ? 'L' : 'M'}${x(index)},${y(item.value)}`).join(' ');
    svg.append(this.svgElement('path', { d: path, class: 'timeline-line' }));
    series.forEach((item, index) => {
      if (item.value) svg.append(this.svgElement('circle', { cx: x(index), cy: y(item.value), r: 4, class: 'timeline-point' }));
    });
    const firstLabel = this.svgElement('text', { x: margin.left, y: height - 10, class: 'chart-label' });
    firstLabel.textContent = this.formatDate(series[0].date.toISOString());
    const lastLabel = this.svgElement('text', { x: width - margin.right, y: height - 10, class: 'chart-label', 'text-anchor': 'end' });
    lastLabel.textContent = this.formatDate(series.at(-1).date.toISOString());
    svg.append(firstLabel, lastLabel);
    container.replaceChildren(svg);
  },

  renderSignalMap(articles) {
    const container = document.getElementById('map');
    const width = Math.max(container.clientWidth, 720);
    const height = 420;
    const svg = this.svgElement('svg', { viewBox: `0 0 ${width} ${height}` });
    const boundaries = [
      [[44.772677,37.170437],[44.293452,37.001514],[43.942259,37.256228],[42.779126,37.385264],[42.349591,37.229873],[41.212089,37.074352],[40.673259,37.091276],[39.52258,36.716054],[38.699891,36.712927],[38.167727,36.90121],[37.066761,36.623036],[36.739494,36.81752],[36.685389,36.259699],[36.149763,35.821535],[35.782085,36.274995],[36.160822,36.650606],[35.550936,36.565443],[34.714553,36.795532],[34.026895,36.21996],[32.509158,36.107564],[31.699595,36.644275],[30.621625,36.677865],[30.391096,36.262981],[29.699976,36.144357],[28.732903,36.676831],[27.641187,36.658822],[27.048768,37.653361],[26.318218,38.208133],[26.8047,38.98576],[26.170785,39.463612],[27.28002,40.420014],[28.819978,40.460011],[29.240004,41.219991],[31.145934,41.087622],[32.347979,41.736264],[33.513283,42.01896],[35.167704,42.040225],[36.913127,41.335358],[38.347665,40.948586],[39.512607,41.102763],[40.373433,41.013673],[41.554084,41.535656],[42.619549,41.583173],[43.582746,41.092143],[43.752658,40.740201],[43.656436,40.253564],[44.400009,40.005],[44.79399,39.713003],[44.109225,39.428136],[44.421403,38.281281],[44.225756,37.971584],[44.772677,37.170437]],
      [[26.117042,41.826905],[27.135739,42.141485],[27.99672,42.007359],[28.115525,41.622886],[28.988443,41.299934],[28.806438,41.054962],[27.619017,40.999823],[27.192377,40.690566],[26.358009,40.151994],[26.043351,40.617754],[26.056942,40.824123],[26.294602,40.936261],[26.604196,41.562115],[26.117042,41.826905]],
    ];
    const minLng = 25.7;
    const maxLng = 45.2;
    const minLat = 35.5;
    const maxLat = 42.4;
    const project = ([lng, lat]) => [
      width * .06 + (lng - minLng) / (maxLng - minLng) * width * .88,
      height * .12 + (maxLat - lat) / (maxLat - minLat) * height * .72,
    ];
    boundaries.forEach(boundary => {
      const d = boundary.map((coordinate, index) => {
        const [x, y] = project(coordinate);
        return `${index ? 'L' : 'M'}${x},${y}`;
      }).join(' ') + ' Z';
      svg.append(this.svgElement('path', { class: 'turkiye-outline', d }));
    });
    const locations = [[28.9784,41.0082],[32.8597,39.9334],[29.0609,40.1885],[27.1428,38.4237],[30.7133,36.8969],[35.3213,37.0000],[37.3781,37.0662],[39.7168,41.0027],[36.3300,41.2867],[40.2306,37.9144],[43.3770,38.5012],[34.6415,36.8121]];
    articles.slice(0, locations.length).forEach((article, index) => {
      const [px, py] = project(locations[index]);
      const group = this.svgElement('g', { class: 'signal-node' });
      const pulse = this.svgElement('circle', { cx: px, cy: py, r: 13, class: 'signal-pulse' });
      const point = this.svgElement('circle', { cx: px, cy: py, r: 5 + Math.min(4, Math.abs(Number(article.tone) || 0)), class: 'signal-point' });
      const title = this.svgElement('title');
      title.textContent = `${article.domain || 'Public source'}: ${this.cleanText(article.title || '')}`;
      group.append(pulse, point, title);
      svg.append(group);
    });
    const label = this.svgElement('text', { x: width * .08, y: height * .87, class: 'map-label' });
    label.textContent = 'Signal nodes represent coverage volume, not event coordinates';
    svg.append(label);
    container.replaceChildren(svg);
    document.getElementById('map-count').textContent = `${articles.length} signals`;
  },

  renderAnalysis(articles) {
    const target = document.getElementById('llm-summary');
    const supplied = this.cleanText(this.data.llm_summary || '');
    if (supplied && !/pending api key|connect openrouter/i.test(supplied)) {
      target.textContent = supplied;
      return;
    }
    const leading = this.groupSources(articles).slice(0, 3).map(group => group.source).join(', ');
    target.textContent = `Current snapshot contains ${articles.length} recent economic-news signals across ${this.uniqueDomains(articles)} domains. Coverage is concentrated in ${leading || 'the available sources'}. The mean reported GDELT tone is near neutral; this describes the observed news sample, not the Turkish economy as a whole.`;
  },

  renderEmpty(containerId, message) {
    const paragraph = document.createElement('p');
    paragraph.className = 'chart-empty';
    paragraph.textContent = message;
    document.getElementById(containerId).replaceChildren(paragraph);
  },

  renderError(error) {
    document.getElementById('data-mode').textContent = 'Data unavailable';
    const status = document.getElementById('status-message');
    status.className = 'alert alert-danger';
    status.innerHTML = `<strong>Dashboard unavailable:</strong> ${error instanceof Error ? error.message : 'Unknown data error'}. Last known values were not presented as live.`;
    this.renderEmpty('map', 'Live data could not be loaded.');
    this.renderEmpty('timeseries-chart', 'Live data could not be loaded.');
  },
};

document.addEventListener('DOMContentLoaded', () => INTEL.init());
