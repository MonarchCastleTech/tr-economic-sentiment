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
    svg.append(this.svgElement('path', {
      class: 'turkiye-outline',
      d: `M${width * .08},${height * .52} L${width * .14},${height * .41} L${width * .25},${height * .38} L${width * .32},${height * .30} L${width * .43},${height * .33} L${width * .51},${height * .27} L${width * .60},${height * .35} L${width * .73},${height * .32} L${width * .91},${height * .44} L${width * .88},${height * .58} L${width * .76},${height * .61} L${width * .69},${height * .70} L${width * .54},${height * .65} L${width * .44},${height * .72} L${width * .30},${height * .64} L${width * .19},${height * .67} Z`,
    }));
    const locations = [[.18,.49],[.39,.43],[.29,.58],[.48,.54],[.61,.47],[.72,.53],[.81,.47],[.57,.61],[.70,.62],[.35,.51],[.86,.53],[.50,.40]];
    articles.slice(0, locations.length).forEach((article, index) => {
      const [px, py] = locations[index];
      const group = this.svgElement('g', { class: 'signal-node' });
      const pulse = this.svgElement('circle', { cx: width * px, cy: height * py, r: 13, class: 'signal-pulse' });
      const point = this.svgElement('circle', { cx: width * px, cy: height * py, r: 5 + Math.min(4, Math.abs(Number(article.tone) || 0)), class: 'signal-point' });
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
