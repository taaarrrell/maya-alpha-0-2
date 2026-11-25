(() => {
'use strict';
const modes = {
  maya: {name:'M.A.Y.A.', caption:'Crimson · Organic swarm', color:[255,49,99]},
  phineas: {name:'PHINEAS', caption:'Silver · Geometric swarm', color:[207,225,255]},
  dream: {name:'DREAM', caption:'Indigo · Drifting swarm', color:[166,113,255]}
};
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const buttons = Array.from(document.querySelectorAll('.mode'));
let visible = true;
let width = 0, height = 0, frame = 0, start = 0;
let weights = [1, 0, 0], source = weights.slice(), target = weights.slice();
const palette = Object.values(modes).map(mode => mode.color);
let seed = 70853;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const dust = Array.from({length: 175}, () => [random(), random(), random()]);
const particles = Array.from({length: 2300}, (_, i) => {
  const z = 1 - 2 * (i + .5) / 2300;
  const spin = i * 2.3999632297;
  return {z, spin, radial: Math.sqrt(1 - z*z), grain: random(), phase: random() * 6.283, edge: random()};
});
const rawVertices = [[0,-1,0],[0,1,0],[1,0,0],[0,0,1],[-1,0,0],[0,0,-1]];
const edges = [];
for (let i = 2; i < 6; i++) {
  edges.push([rawVertices[0],rawVertices[i]],[rawVertices[1],rawVertices[i]],[rawVertices[i],rawVertices[i === 5 ? 2 : i+1]]);
}
function draw(time) {
  if (!visible || !ctx || !width || !height) return;
  const t = motion.matches ? 1.8 : time * .001;
  const cx = width * .5, cy = height * .465;
  const size = Math.min(width * .33, height * .337);
  const color = [0,1,2].map(channel => Math.round(palette.reduce((sum, rgb, i) => sum + rgb[channel]*weights[i], 0))).join(',');
  ctx.clearRect(0,0,width,height);
  ctx.strokeStyle = 'rgba('+color+',.13)';
  ctx.lineWidth = 1;
  for (const radius of [1.14,1.31]) {
    ctx.beginPath();
    ctx.arc(cx,cy,size*radius,0,Math.PI*2);
    ctx.stroke();
  }
  ctx.beginPath();
  for (const direction of [-1,1]) {
    ctx.moveTo(cx+direction*size*1.31,cy);
    ctx.lineTo(cx+direction*size*1.47,cy);
    ctx.moveTo(cx,cy+direction*size*1.31);
    ctx.lineTo(cx,cy+direction*size*1.40);
  }
  ctx.stroke();
  for (const [x,y,a] of dust) {
    ctx.fillStyle = 'rgba('+color+','+(.075+a*.25)+')';
    ctx.fillRect(x*width,y*height,1+a,1);
  }
  const yaw = t*.27+.46, pitch = .33 + Math.sin(t*.36)*.17;
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw), cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  particles.forEach((p,i) => {
    const a = p.spin + t*.31;
    const warp = .89 + .15*Math.sin(4*a+5*p.z+t*1.35) + .10*Math.cos(7*p.z-t+p.phase*.14);
    const sphere = [.94*p.radial*Math.cos(a)*warp, p.z*warp, p.radial*Math.sin(a)*warp];
    const [v,w] = edges[i % edges.length];
    const f = p.grain;
    const spread = p.edge < .74 ? .045 : .24;
    const geometry = v.map((value,k) => (value+(w[k]-value)*f)*1.17 + spread*Math.sin(p.phase+k*2.1));
    const lane = i % 4;
    const da = p.spin+t*.24+lane*.24;
    const radius = (.42 + .55*p.grain) * (1+.13*Math.sin(3*da+t));
    const dream = [Math.cos(da)*radius, .48*Math.sin(da)*radius + .39*Math.sin(2*da+lane*1.5+t*.42) + (p.edge-.5)*.31, Math.sin(da)*radius + (lane-1.5)*.13];
    const [x,y,z] = sphere.map((value,k) => value*weights[0] + geometry[k]*weights[1] + dream[k]*weights[2]);
    const dx = x*cosY + z*sinY;
    const dz = z*cosY - x*sinY;
    const dy = y*cosP - dz*sinP;
    const depth = y*sinP + dz*cosP;
    const perspective = 1 + depth*.17;
    const alpha = Math.max(.08, .24 + depth*.21 + p.grain*.39);
    const dot = .55+p.grain*1.2+Math.max(0,depth)*.65;
    ctx.fillStyle = p.edge > .965 ? 'rgba(255,246,255,'+alpha+')' : 'rgba('+color+','+alpha+')';
    ctx.fillRect(cx+dx*size*perspective,cy+dy*size*perspective,dot,dot);
  });
}
function tick(time) {
  const progress = Math.min(1, (time-start)/740);
  const eased = progress*progress*(3-2*progress);
  weights = source.map((value,i) => value+(target[i]-value)*eased);
  draw(time);
  frame = requestAnimationFrame(tick);
}
function syncAnimation() {
  cancelAnimationFrame(frame);
  if (!visible) return;
  if (motion.matches) {
    weights = target.slice();
    draw(0);
  } else {
    frame = requestAnimationFrame(tick);
  }
}
function resize() {
  const bounds = canvas.getBoundingClientRect();
  width = bounds.width;
  height = bounds.height;
  const scale = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width*scale);
  canvas.height = Math.round(height*scale);
  if (ctx) ctx.setTransform(scale,0,0,scale,0,0);
  draw(performance.now());
}
function selectMode(key) {
  const mode = modes[key];
  document.documentElement.dataset.mode = key;
  document.querySelector('#mode-title').textContent = mode.name;
  document.querySelector('#mode-description').textContent = mode.caption;
  buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.key === key)));
  source = weights.slice();
  target = buttons.map(button => Number(button.dataset.key === key));
  start = performance.now();
  if (motion.matches && visible) syncAnimation();
}

buttons.forEach(button => button.addEventListener('click', () => selectMode(button.dataset.key)));
if (motion.addEventListener) motion.addEventListener('change', syncAnimation);
else motion.addListener(syncAnimation);
if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
else addEventListener('resize', resize);
resize();
syncAnimation();
window.MayaSwarm = Object.freeze({
  setVisible(next) {
    visible = next;
    canvas.hidden = !next;
    syncAnimation();
  }
});
})();
