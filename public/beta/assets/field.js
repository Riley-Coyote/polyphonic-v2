/* Polyphonic — the ambient field (WP-19).

   The page's one moving surface: a fixed, full-page dot lattice that reveals where the pointer
   moves, where the scroll drags it, and — faintly, ambient 0.04 — where three slow drifters pass.
   It is the prototype's `touch` scene, run on the prototype's engine.

   Two engine files ship verbatim from the design hand-off and are never edited here:
     assets/dot-display.js    the Display (lattice, phosphor, mount loop)
     assets/mnemos-scenes.js  its scene pack, loaded as the prototype loads it
   Everything this file adds is a wrapper: the scene registration, the pointer/scroll globals the
   scene reads, the mount, and the visibility gate.

   Gating. The engine's shared loop is ~26fps and already skips animation entirely under
   prefers-reduced-motion (one settle frame, no rAF). It does not stop itself when the tab is
   hidden, so this file stops the mount handle on `visibilitychange` and re-mounts on return —
   from outside the engine, as WP-19 requires. Result: zero animation frames while hidden.
*/
(() => {
'use strict';
const CV = document.querySelector('canvas[data-scene="touch"]');
if (!CV) return;

const load = src => new Promise((res, rej) => {
  const t = document.createElement('script');
  t.src = src; t.onload = res; t.onerror = rej;
  document.head.appendChild(t);
});
const ready = () => window.DotDisplay && window.DotDisplay.scenes && window.DotDisplay.scenes.memory;

/* the scene's two inputs, as the prototype feeds them */
self.__ambient = 0.04;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const P = { x: -1e4, y: -1e4 };
window.addEventListener('pointermove', e => { P.x = e.clientX; P.y = e.clientY; }, { passive: true });
document.addEventListener('pointerleave', () => { P.x = -1e4; P.y = -1e4; });
if (!reduce.matches) {
  let ly = window.scrollY || 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY || window.pageYOffset || 0, dv = y - ly; ly = y;
    self.__scrollV = Math.max(-130, Math.min(130, dv)); self.__svAt = performance.now();
  }, { passive: true });
}

/* ------------------------------------------------------------------ the scene
   Verbatim from the prototype's `DD.scenes.touch`, with one omission: the `formations` block,
   which draws per-row figures around elements carrying [data-field]. Neither the prototype's page
   nor this one has such an element, so the block never ran; it is also the only part that needs
   the identity-glyph code, which WP-18 keeps out of the browser. Its two buffers (F, FR) are still
   cleared each frame so the paint below is unchanged. */
const register = () => {
  const DD = window.DotDisplay; if (!DD) return;
  const hash = DD.hash, PD = [42, 43, 42], PH = [239, 239, 237];
  const hops = (nodes, seed, LR) => { const lev = new Int16Array(nodes.length).fill(-1); let fr = [seed]; lev[seed] = 0; let depth = 0;
    while (fr.length && depth < 6) { const nx = []; for (const i of fr) { const a = nodes[i]; for (let j = 0; j < nodes.length; j++) { if (lev[j] >= 0) continue; const b = nodes[j]; if (Math.hypot(b.x - a.x, b.y - a.y) <= LR) { lev[j] = depth + 1; nx.push(j); } } } fr = nx; depth++; }
    return lev; };
  const MS = 22;
      DD.scenes.touch=function(d,t){
        const S=d.s, cell=d.cell, cols=d.cols, rows=d.rows;
        if(!S.nodes||S.cols!==cols||S.rows!==rows){
          S.cols=cols; S.rows=rows;
          const N=Math.min(520,Math.round(cols*rows/190));
          S.nodes=[]; for(let i=0;i<N;i++) S.nodes.push({hx:hash(i,7,3)*cols,hy:hash(i,19,11)*rows,fx:0.00009+hash(i,3,29)*0.00018,fy:0.00007+hash(i,31,5)*0.00016,ph:hash(i,41,17)*6.2832,amp:0.8+hash(i,13,23)*1.8,base:0.42+hash(i,53,9)*0.44,a:0,x:0,y:0});
          S.waves=[]; S.lastSeedAt=0; S.lastSx=-1e4; S.lastSy=-1e4;
          S.mw=Math.ceil(d.w/MS)+2; S.mh=Math.ceil(d.h/MS)+2;
          S.M=new Float32Array(S.mw*S.mh); S.M2=new Float32Array(S.mw*S.mh); S.U=new Float32Array(S.mw*S.mh); S.V=new Float32Array(S.mw*S.mh);
          S.F=new Float32Array(cols*rows); S.FR=new Float32Array(cols*rows); S.drawn=new Uint8Array(cols*rows);
          S.px=-1e4; S.py=-1e4; S.last=t; S.vis=new Map(); S.g={};
        }
        const nodes=S.nodes, NN=nodes.length, LR=Math.max(9,Math.min(14,cols*0.05));
        const mw=S.mw, mh=S.mh, M=S.M, M2=S.M2, U=S.U, V=S.V, F=S.F, FR=S.FR;
        const dtms=Math.min(80,Math.max(16,t-S.last)); S.last=t; const k=dtms/38;
        /* ---- fluid reveal ---- */
        const inside=P.x>-1e3;
        if(inside){
          if(S.px<-1e3){ S.px=P.x; S.py=P.y; }
          const dx=P.x-S.px, dy=P.y-S.py, sp=Math.hypot(dx,dy);
          const amt=0.10+Math.min(1,sp/28)*0.42;
          const steps=Math.max(1,Math.ceil(sp/(MS*0.5)));
          for(let si=0;si<steps;si++){ const kk=(si+1)/steps; const gx=(S.px+dx*kk)/MS, gy=(S.py+dy*kk)/MS;
            for(let yy=-4;yy<=4;yy++) for(let xx=-4;xx<=4;xx++){ const mx=Math.round(gx)+xx, my=Math.round(gy)+yy; if(mx<0||my<0||mx>=mw||my>=mh) continue; const dd=Math.hypot(mx-gx,my-gy); const g=Math.exp(-dd*dd/7); const i=my*mw+mx; M[i]=Math.min(1.4,M[i]+amt*g/steps); U[i]=Math.max(-0.5,Math.min(0.5,U[i]+dx*0.012*g/steps)); V[i]=Math.max(-0.5,Math.min(0.5,V[i]+dy*0.012*g/steps)); } }
          S.px=P.x; S.py=P.y;
        } else { S.px=-1e4; }
        /* ambient currents: three slow drifters keep a faint reveal alive when the pointer is still */
        const amb=Math.max(0,Math.min(1,+(self.__ambient??0.3)));
        if(amb>0){ for(let gi=0;gi<3;gi++){ const gx=d.w*(0.5+0.44*Math.sin(t*0.000052*(1+gi*0.37)+gi*2.1)), gy=d.h*(0.5+0.40*Math.cos(t*0.000041*(1+gi*0.29)+gi*1.3)); const mx=Math.round(gx/MS), my=Math.round(gy/MS);
            for(let yy=-5;yy<=5;yy++) for(let xx=-5;xx<=5;xx++){ const x=mx+xx, y=my+yy; if(x<0||y<0||x>=mw||y>=mh) continue; const dd=Math.hypot(xx,yy); const g=Math.exp(-dd*dd/9); const i=y*mw+x; M[i]=Math.min(1.4,M[i]+0.11*amb*g*k); } }
          if(t-(S.gSeedAt||0)>2600){ S.gSeedAt=t; const gi=(S.gi=((S.gi||0)+1)%3); const gx=(d.w*(0.5+0.44*Math.sin(t*0.000052*(1+gi*0.37)+gi*2.1))-d.ox)/cell, gy=(d.h*(0.5+0.40*Math.cos(t*0.000041*(1+gi*0.29)+gi*1.3))-d.oy)/cell; let best=-1,bd=1e9; for(let i=0;i<NN;i++){ const n=nodes[i]; const dd=Math.hypot(n.x-gx,n.y-gy); if(dd<bd){bd=dd;best=i;} } if(best>=0){ S.waves.push({t0:t,lev:hops(nodes,best,LR),seed:best}); if(S.waves.length>5) S.waves.shift(); } } }
        /* the scroll drags the material: a band of charge enters from the direction of travel and streaks */
        try{
        const rawSv=(performance.now()-(self.__svAt||0)<110)?(self.__scrollV||0):0;
        S.sv=(S.sv||0)+(rawSv-(S.sv||0))*0.16;
        const sv=S.sv;
        if(Math.abs(sv)>1.1){
          const amt=Math.min(1,Math.abs(sv)/44), bc=(sv>0?0.62:0.38)*mh, bwd=mh*0.26;
          const ys=Math.max(0,Math.floor(bc-bwd*1.9)), ye=Math.min(mh-1,Math.ceil(bc+bwd*1.9));
          for(let y=ys;y<=ye;y++){ const fall=Math.exp(-Math.pow((y-bc)/bwd,2));
            for(let x=0;x<mw;x++){ const i=y*mw+x, nz=hash(x*3+1,y*5+2,13); if(nz<0.5) continue;
              M[i]=Math.min(1.4,M[i]+0.42*amt*fall*(nz-0.5)*2*k);
              V[i]=Math.max(-0.6,Math.min(0.6,V[i]-sv*0.0105*fall)); } }
        }
        }catch(err){ if(!S.errS){ S.errS=1; console.error('scroll wake',err); } }
        for(let y=0;y<mh;y++) for(let x=0;x<mw;x++){ const i=y*mw+x; const ux=Math.max(-0.6,Math.min(0.6,U[i]*k)), uy=Math.max(-0.6,Math.min(0.6,V[i]*k)); const sx=x-ux, sy=y-uy; const x0=Math.floor(sx), y0=Math.floor(sy); const fx=sx-x0, fy=sy-y0;
          const g=(xx,yy)=>(xx<0||yy<0||xx>=mw||yy>=mh)?0:M[yy*mw+xx];
          M2[i]=(g(x0,y0)*(1-fx)+g(x0+1,y0)*fx)*(1-fy)+(g(x0,y0+1)*(1-fx)+g(x0+1,y0+1)*fx)*fy; }
        const decay=Math.pow(0.984,k), vdec=Math.pow(0.92,k);
        for(let y=0;y<mh;y++) for(let x=0;x<mw;x++){ const i=y*mw+x; const l=x>0?M2[i-1]:0, r=x<mw-1?M2[i+1]:0, u=y>0?M2[i-mw]:0, b=y<mh-1?M2[i+mw]:0; M[i]=(M2[i]*0.56+(l+r+u+b)*0.11)*decay;
          const ul=x>0?U[i-1]:0, ur=x<mw-1?U[i+1]:0, uu=y>0?U[i-mw]:0, ub=y<mh-1?U[i+mw]:0; U[i]=(U[i]*0.6+(ul+ur+uu+ub)*0.1)*vdec;
          const vl=x>0?V[i-1]:0, vr=x<mw-1?V[i+1]:0, vu=y>0?V[i-mw]:0, vb=y<mh-1?V[i+mw]:0; V[i]=(V[i]*0.6+(vl+vr+vu+vb)*0.1)*vdec; }
        let bx0=1e9,by0=1e9,bx1=-1,by1=-1;
        for(let y=0;y<mh;y++) for(let x=0;x<mw;x++){ if(M[y*mw+x]>0.003){ if(x<bx0)bx0=x; if(x>bx1)bx1=x; if(y<by0)by0=y; if(y>by1)by1=y; } }
        const boxes=[];
        if(bx1>=0) boxes.push([Math.max(1,Math.floor(((bx0-1)*MS-d.ox)/cell)),Math.max(0,Math.floor(((by0-1)*MS-d.oy)/cell)),Math.min(cols-2,Math.ceil(((bx1+2)*MS-d.ox)/cell)),Math.min(rows-1,Math.ceil(((by1+2)*MS-d.oy)/cell))]);
        /* ---- graph under the cursor ---- */
        d.fade(0.92);
        for(let i=0;i<NN;i++){ const n=nodes[i]; n.x=n.hx+Math.sin(t*n.fx+n.ph)*n.amp; n.y=n.hy+Math.cos(t*n.fy+n.ph*1.7)*n.amp; }
        if(inside){ const scx=(P.x-d.ox)/cell, scy=(P.y-d.oy)/cell; const moved=Math.hypot(scx-S.lastSx,scy-S.lastSy);
          if(moved>6&&t-S.lastSeedAt>220){ let best=-1,bd=1e9; for(let i=0;i<NN;i++){ const n=nodes[i]; const dd=Math.hypot(n.x-scx,n.y-scy); if(dd<bd){bd=dd;best=i;} } if(best>=0&&bd<24){ S.waves.push({t0:t,lev:hops(nodes,best,LR),seed:best}); if(S.waves.length>5) S.waves.shift(); S.lastSeedAt=t; S.lastSx=scx; S.lastSy=scy; } } }
        for(let i=0;i<NN;i++){ let a=0; for(const w of S.waves){ const L=w.lev[i]; if(L<0) continue; const dt=(t-w.t0)-L*210; if(dt>-200&&dt<1300){ const v=1-Math.abs(dt-240)/820; if(v>a) a=v; } } nodes[i].a=a<0?0:a; }
        if(boxes.length){ const [cx0,cy0,cx1,cy1]=boxes[0];
          for(let y=cy0;y<=cy1;y++) for(let x=cx0;x<=cx1;x++){ const nz=hash(x,y,1); if(nz<0.62) continue; const s2=Math.sin((x*0.17+y*0.12)-t*0.00052); d.set(x,y,0.05+(nz-0.62)*0.22+0.07*(0.5+0.5*s2)); }
          for(let i=0;i<NN;i++){ const a=nodes[i]; if(a.x<cx0-LR||a.x>cx1+LR||a.y<cy0-LR||a.y>cy1+LR) continue;
            for(let j=i+1;j<NN;j++){ const b=nodes[j]; const dist=Math.hypot(b.x-a.x,b.y-a.y); if(dist>LR) continue; const near=1-dist/LR; const act=a.a>b.a?a.a:b.a; const v=0.30*near+0.70*act*near; if(v>0.03) d.link(a.x,a.y,b.x,b.y,v,2); } }
          for(const w of S.waves){ const age=t-w.t0; if(age<0||age>1600) continue; const n=nodes[w.seed]; const v=0.42*(1-age/1600), rr=age*0.017; if(v<0.02) continue; const steps=Math.max(12,Math.round(rr*5)); for(let q=0;q<steps;q++){ const an=q/steps*6.2832; d.set(n.x+Math.cos(an)*rr,n.y+Math.sin(an)*rr,v*(0.6+0.4*hash(q,w.seed,3))); } }
          for(let i=0;i<NN;i++){ const n=nodes[i]; if(n.x<cx0-LR||n.x>cx1+LR||n.y<cy0-LR||n.y>cy1+LR) continue; let s2=n.base+n.a*0.58; if(s2>1) s2=1; d.disc(n.x,n.y,1.4+n.base*1.6+n.a*2.0,s2*0.95,true); d.set(n.x,n.y,1); }
        }
        /* ---- formations omitted (no [data-field] anchors on this page); buffers still cleared ---- */
        F.fill(0); FR.fill(0);
        /* ---- paint ---- */
        const ctx=d.ctx; ctx.clearRect(0,0,d.w,d.h);
        const q=d.q, drawn=S.drawn; drawn.fill(0);
        const gM=(xx,yy)=>(xx<0||yy<0||xx>=mw||yy>=mh)?0:M[yy*mw+xx];
        for(const [x0,y0,x1,y1] of boxes){
          for(let y=y0;y<=y1;y++){ const cyp=d.oy+y*cell+cell/2, py=cyp/MS, my0=Math.floor(py), fy=py-my0;
            for(let x=x0;x<=x1;x++){ const i=y*cols+x; if(drawn[i]) continue; drawn[i]=1;
              const cxp=d.ox+x*cell+cell/2, px=cxp/MS, mx0=Math.floor(px), fx=px-mx0;
              let m=(gM(mx0,my0)*(1-fx)+gM(mx0+1,my0)*fx)*(1-fy)+(gM(mx0,my0+1)*(1-fx)+gM(mx0+1,my0+1)*fx)*fy;
              const f=F[i];
              if(m<0.004&&f<0.01) continue;
              m=Math.min(1,m*1.25); const a=Math.pow(m,1.6);
              let cf=q[i]*Math.min(1,a*1.1); if(cf>1) cf=1;
              let lum=a*(cf<0.02?0.38:0.82), c=cf, rf=1;
              if(f>0.01){ const fl=f*0.86; if(fl>lum){ lum=fl; } if(f>c){ c=f; rf=FR[i]||1; } c=Math.min(1,c+0.22*a*f); }
              if(lum<0.025) continue;
              ctx.fillStyle='rgb('+(((PD[0]+(PH[0]-PD[0])*c)*lum)|0)+','+(((PD[1]+(PH[1]-PD[1])*c)*lum)|0)+','+(((PD[2]+(PH[2]-PD[2])*c)*lum)|0)+')';
              ctx.beginPath(); ctx.arc(cxp,cyp,cell*(0.13+0.24*c)*(0.65+0.35*Math.max(a,f))*rf,0,6.2832); ctx.fill(); } }
        }
      };
};

/* ------------------------------------------------------------------ mount + visibility gate */
let handle = null;
const mount = () => {
  if (handle) return;
  try { handle = window.DotDisplay.mount(document.body); } catch (e) { console.error(e); return; }
  [300, 1200, 3000].forEach(ms => setTimeout(() => { if (handle && handle.settle) handle.settle(); }, ms));
};
const unmount = () => { if (handle && handle.stop) handle.stop(); handle = null; };

const boot = async () => {
  if (!ready()) {
    if (!window.DotDisplay) await load('/beta/assets/dot-display.js?v=20260915-wp19-1');
    if (!ready()) await load('/beta/assets/mnemos-scenes.js?v=20260915-wp19-1');
  }
  register();
  if (!document.hidden) mount();
  document.addEventListener('visibilitychange', () => { if (document.hidden) unmount(); else mount(); });
};
boot().catch(e => console.error(e));
})();
