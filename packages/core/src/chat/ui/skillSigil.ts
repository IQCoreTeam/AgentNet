// The client-side skill-sigil generator the webview runs (string injected into its <script>).
// Ported from surfaces/webview/src/market/skillSigil.ts: from a skill's NAME we derive a
// deterministic "magic-circle" sigil SVG (concentric rings, radial ticks, an inscribed
// polygon/star, rune marks). Same name => same art, always. Not AI; a seeded mulberry32 PRNG,
// like the wallet avatar. The sigil colour is a fixed mono light-grey (the SD-card screen is
// near-black), so only the SHAPE varies per name.
//
// Helpers are uniquely named (_sk*) so they never collide with AVATAR_SCRIPT's own hashSeed/rng
// in the shared webview <script> scope. The body uses '+' concatenation (never ${...}) so it
// survives being injected inside webview.ts's outer template literal untouched.
export const SKILL_SIGIL_SCRIPT = `
  function _skHash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
  function _skRng(s){let a=_skHash(s);return function(){a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
  function skillSigilSvg(name){
    const col='hsl(228 5% 82%)';
    const r=_skRng((name||'')+'::sigil');
    const cx=60, cy=74; let s='';
    const rings=2+Math.floor(r()*2);
    for(let i=0;i<rings;i++){const rad=22+i*9+r()*4;s+='<circle cx="'+cx+'" cy="'+cy+'" r="'+rad.toFixed(1)+'" fill="none" stroke="'+col+'" stroke-width="0.7" opacity="'+(0.14+r()*0.14).toFixed(2)+'"/>';}
    const ticks=12+Math.floor(r()*24); const t1=29+r()*3; const t2=t1+6+r()*4;
    for(let i=0;i<ticks;i++){const a=(i/ticks)*Math.PI*2;const x1=cx+Math.cos(a)*t1,y1=cy+Math.sin(a)*t1,x2=cx+Math.cos(a)*t2,y2=cy+Math.sin(a)*t2;s+='<line x1="'+x1.toFixed(1)+'" y1="'+y1.toFixed(1)+'" x2="'+x2.toFixed(1)+'" y2="'+y2.toFixed(1)+'" stroke="'+col+'" stroke-width="0.6" opacity="0.2"/>';}
    const sides=3+Math.floor(r()*5); const rot=r()*Math.PI*2; const pr=12+r()*5; const pts=[];
    for(let i=0;i<sides;i++){const a=rot+(i/sides)*Math.PI*2;pts.push([cx+Math.cos(a)*pr,cy+Math.sin(a)*pr]);}
    const poly=pts.map(function(p){return p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ');
    s+='<polygon points="'+poly+'" fill="none" stroke="'+col+'" stroke-width="0.8" opacity="0.3"/>';
    if(sides>=5){const star=[];for(let i=0;i<sides;i++)star.push(pts[(i*2)%sides]);const sp=star.map(function(p){return p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ');s+='<polygon points="'+sp+'" fill="none" stroke="'+col+'" stroke-width="0.6" opacity="0.22"/>';}
    for(let k=0;k<pts.length;k++){const p=pts[k];s+='<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="'+(1+r()*1.3).toFixed(1)+'" fill="'+col+'" opacity="0.4"/>';}
    s+='<circle cx="'+cx+'" cy="'+cy+'" r="'+(2+r()*3).toFixed(1)+'" fill="none" stroke="'+col+'" stroke-width="0.8" opacity="0.32"/>';
    const runes=6+Math.floor(r()*8);
    for(let i=0;i<runes;i++){const a=r()*Math.PI*2;const rr=5+r()*28;const x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr;const len=2+r()*4;s+='<line x1="'+x.toFixed(1)+'" y1="'+y.toFixed(1)+'" x2="'+(x+len).toFixed(1)+'" y2="'+y.toFixed(1)+'" stroke="'+col+'" stroke-width="0.6" opacity="'+(0.12+r()*0.18).toFixed(2)+'"/>';}
    return s;
  }
`;
