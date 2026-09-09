/* Original Mnemos field retained; lifecycle managed centrally for this page. */
(() => {
const P={x:-10000,y:-10000};self.__ambient=.18;
function emblem(seed,n,density){
  let h=2166136261;
  for(let i=0;i<seed.length;i++){h^=seed.charCodeAt(i);h=Math.imul(h,16777619);}
  const rnd=()=>{h^=h<<13;h^=h>>>17;h^=h<<5;h|=0;return ((h>>>0)%10000)/10000;};
  const half=Math.ceil(n/2),out=new Array(n*n).fill(0);
  for(let y=0;y<n;y++)for(let x=0;x<half;x++){const on=rnd()<density?1:0;out[y*n+x]=on;out[y*n+(n-1-x)]=on;}
  return out;
}

const reg=()=>{ const DD=window.DotDisplay; if(!DD||DD.scenes.touch) return;
      const hash=DD.hash, FONT=DD.FONT, PD=[42,43,42], PH=[239,239,237];
      const EMB={luca:emblem('luca',9,.42),research:emblem('research',9,.42),vektor:emblem('vektor',9,.42),ziggy:emblem('ziggy',9,.42)};
      const WORD=(()=>{ const out=[]; const s='TOGETHER'; for(let n=0;n<s.length;n++){ const g=(FONT[s[n]]||FONT[' ']).split(','); for(let r=0;r<7;r++) for(let c=0;c<5;c++) if(g[r][c]==='1') out.push([n*6+c,r]); } return out; })();
      const WORDW=8*6-1;
      const hops=(nodes,seed,LR)=>{ const lev=new Int16Array(nodes.length).fill(-1); let fr=[seed]; lev[seed]=0; let depth=0;
        while(fr.length&&depth<6){ const nx=[]; for(const i of fr){ const a=nodes[i]; for(let j=0;j<nodes.length;j++){ if(lev[j]>=0) continue; const b=nodes[j]; if(Math.hypot(b.x-a.x,b.y-a.y)<=LR){ lev[j]=depth+1; nx.push(j); } } } fr=nx; depth++; }
        return lev; };
      /* the band, without phosphor trails: the buffer is cleared every frame so letters stay sharp */
      DD.scenes['marquee-crisp']=function(d,t,cv){ d.clear(); const txt=((cv&&cv.dataset.text)||'').toUpperCase(); const w=d.measure(txt)+12; const off=Math.round((t*0.016)%w); const y=Math.round((d.rows-7)/2); d.text(txt,-off,y,0.95); d.text(txt,-off+w,y,0.95); d.draw(t); };
      const MS=22;
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
        /* ---- formations: the field draws each row's idea ---- */
        F.fill(0); FR.fill(0);
        const put=(x,y,v,r)=>{ x=Math.round(x); y=Math.round(y); if(x<0||y<0||x>=cols||y>=rows) return; const i=y*cols+x; if(v>F[i]){ F[i]=v; FR[i]=r||1; } };
        const putEmb=(E,cx,cy,s,v,r,dth)=>{ for(let yy=0;yy<9;yy++) for(let xx=0;xx<9;xx++){ if(!E[yy*9+xx]) continue; if(dth!=null&&hash(xx,yy,9)>dth) continue; put(cx+(xx-4)*s,cy+(yy-4)*s,v,r); } };
        const dotted=(x0,y0,x1,y1,v,step)=>{ const dd=Math.max(2,Math.round(Math.hypot(x1-x0,y1-y0))); for(let i=1;i<dd;i+=step){ const q=i/dd; put(x0+(x1-x0)*q,y0+(y1-y0)*q,v,1); } };
        const R2C=r=>({x0:(r.left-d.ox)/cell,y0:(r.top-d.oy)/cell,x1:(r.right-d.ox)/cell,y1:(r.bottom-d.oy)/cell});
        const clampTo=(x,y,c)=>[Math.max(c.x0,Math.min(c.x1,x)),Math.max(c.y0,Math.min(c.y1,y))];
        if(!S.anch||t-S.anchAt>700){ const root=d.cv.parentElement; S.anch=root?Array.from(root.querySelectorAll('[data-field]')):[]; S.anchAt=t; }
        for(const el of S.anch){
          const r=el.getBoundingClientRect(); let tv=0;
          if(!(r.bottom<-40||r.top>d.h+40)){ const ov=(Math.min(r.bottom,d.h)-Math.max(r.top,0))/Math.min(r.height,d.h*0.55); tv=Math.max(0,Math.min(1,ov)); }
          const pv=S.vis.get(el)||0; const vis=pv+(tv-pv)*0.07; S.vis.set(el,vis); if(vis<0.02) continue;
          const e=vis*vis*(3-2*vis), kind=el.dataset.field, rc=R2C(r);
          const card=el.querySelector('[data-card]'); const cc=card?R2C(card.getBoundingClientRect()):null;
          const bw=rc.x1-rc.x0, bh=rc.y1-rc.y0; const cxm=(rc.x0+rc.x1)/2, cym=(rc.y0+rc.y1)/2;
          if(kind==='word'){
            if(!S.wordT0) S.wordT0=t; const p=Math.min(1,(t-S.wordT0)/1700);
            let s=Math.max(2,Math.floor(bh/7)); s=Math.max(2,Math.min(s,Math.floor(bw/WORDW)));
            const ox=cxm-WORDW*s/2+s/2, oy=cym-7*s/2+s/2;
            for(const [gx,gy] of WORD){ const hh=hash(gx,gy,5); if(hh>p*1.12) continue; const br=0.66+0.26*(0.5+0.5*Math.sin(t*0.0011+gx*0.35+gy*0.5)); put(ox+gx*s,oy+gy*s,br*e,s*0.95); }
          } else if(kind==='emblems'&&cc&&bw>96){
            const s=2, ins=13; const pos=[[rc.x0+ins,rc.y0+ins,'luca'],[rc.x1-ins,rc.y0+ins,'research'],[rc.x0+ins,rc.y1-ins,'vektor'],[rc.x1-ins,rc.y1-ins,'ziggy']];
            pos.forEach(([x,y,who],i)=>{ const ph=((t*0.00028)+i*0.25)%1; const gl=0.55+0.45*Math.exp(-Math.pow((ph-0.5)*3.2,2)); putEmb(EMB[who],x,y,s,gl*e,1.7,e*1.15); const [tx,ty]=clampTo(x,y,cc); dotted(x+(tx>x?9:-9),y+(ty>y?9:-9),tx,ty,(0.22+0.3*gl)*e,2); });
          } else if(kind==='graph'&&cc){
            let G=S.g.graph; if(!G||G.w!==Math.round(bw)){ G=S.g.graph={w:Math.round(bw),n:[],waves:[],next:0}; for(let i=0;i<30;i++) G.n.push({u:hash(i,5,17),v:hash(i,23,7),f:0.00008+hash(i,3,3)*0.0001,ph:hash(i,11,13)*6.28,base:0.4+hash(i,29,31)*0.4,a:0}); }
            const NG=G.n.length, LG=Math.max(8,bw*0.16);
            for(let i=0;i<NG;i++){ const n=G.n[i]; n.x=rc.x0+3+n.u*(bw-6)+Math.sin(t*n.f+n.ph)*1.2; n.y=rc.y0+3+n.v*(bh-6)+Math.cos(t*n.f*1.3+n.ph)*1.2; }
            if(t>G.next){ const seed=Math.floor(hash(G.waves.length+1,7,3)*NG)%NG; G.waves.push({t0:t,seed,lev:hops(G.n,seed,LG)}); if(G.waves.length>3) G.waves.shift(); G.next=t+1500+hash(G.waves.length,3,11)*1400; }
            for(let i=0;i<NG;i++){ let a=0; for(const w of G.waves){ const L=w.lev[i]; if(L<0) continue; const dt=(t-w.t0)-L*260; if(dt>-200&&dt<1400){ const v=1-Math.abs(dt-260)/880; if(v>a) a=v; } } G.n[i].a=a<0?0:a; }
            const hidden=(x,y)=>x>cc.x0-1&&x<cc.x1+1&&y>cc.y0-1&&y<cc.y1+1;
            for(let i=0;i<NG;i++) for(let j=i+1;j<NG;j++){ const a=G.n[i], b=G.n[j]; const dist=Math.hypot(b.x-a.x,b.y-a.y); if(dist>LG) continue; const near=1-dist/LG; const act=Math.max(a.a,b.a); const v=(0.16+0.6*act)*near*e; if(v<0.03) continue; const dd=Math.round(dist); for(let q=1;q<dd;q+=2){ const kq=q/dd; const x=a.x+(b.x-a.x)*kq, y=a.y+(b.y-a.y)*kq; if(!hidden(x,y)) put(x,y,v,1); } }
            for(let i=0;i<NG;i++){ const n=G.n[i]; if(hidden(n.x,n.y)) continue; const v=Math.min(1,(n.base+n.a*0.6))*e; put(n.x,n.y,v,1.5+n.a); put(n.x+1,n.y,v*0.35,1); put(n.x-1,n.y,v*0.35,1); put(n.x,n.y+1,v*0.35,1); put(n.x,n.y-1,v*0.35,1); }
          } else if(kind==='exchange'&&cc){
            const side=(bw-(cc.x1-cc.x0))/2; const s=2;
            const L=side>26?[rc.x0+12,cym]:[rc.x0+13,rc.y0+13], Rr=side>26?[rc.x1-12,cym]:[rc.x1-13,rc.y1-13];
            const ph=(t*0.00028)%1; const gl=(c)=>0.55+0.45*Math.exp(-Math.pow((ph-c)*4,2));
            putEmb(EMB.luca,L[0],L[1],s,gl(0.05)*e,1.7,e*1.15); putEmb(EMB.research,Rr[0],Rr[1],s,gl(0.5)*e,1.7,e*1.15);
            const la=clampTo(L[0],L[1],cc), rb=clampTo(Rr[0],Rr[1],cc);
            const l0=[L[0]+(la[0]>L[0]?9:-9),L[1]+(la[1]>L[1]?9:(la[1]<L[1]?-9:0))], r0=[Rr[0]+(rb[0]>Rr[0]?9:-9),Rr[1]+(rb[1]>Rr[1]?9:(rb[1]<Rr[1]?-9:0))];
            dotted(l0[0],l0[1],la[0],la[1],0.26*e,2); dotted(r0[0],r0[1],rb[0],rb[1],0.26*e,2);
            /* one pulse: out along the left link, across (hidden by the card), back along the right, then home */
            const seg=(a,b,q)=>[a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q];
            let pt=null; if(ph<0.18) pt=seg(l0,la,ph/0.18); else if(ph>=0.32&&ph<0.5) pt=seg(rb,r0,(ph-0.32)/0.18); else if(ph>=0.55&&ph<0.73) pt=seg(r0,rb,(ph-0.55)/0.18); else if(ph>=0.82) pt=seg(la,l0,(ph-0.82)/0.18);
            if(pt){ put(pt[0],pt[1],1*e,2.2); put(pt[0]+1,pt[1],0.5*e,1.3); put(pt[0]-1,pt[1],0.5*e,1.3); put(pt[0],pt[1]+1,0.5*e,1.3); put(pt[0],pt[1]-1,0.5*e,1.3); }
          } else if(kind==='ledger'&&cc){
            const band=rc.y1-cc.y1; if(band>13){ const n=Math.min(4,Math.floor((band-4)/3)); const w=bw*0.56, x0=cxm-w/2; const ph=(t*0.00022)%1;
              for(let i=0;i<n;i++){ const y=cc.y1+4+i*3; const on=ph>(i+1)/(n+1); dotted(x0,y,x0+w,y,(on?0.34:0.16)*e,2); put(x0-2,y,(on?0.5:0.25)*e,1.4); if(on){ const age=Math.max(0,ph-(i+1)/(n+1)); put(x0+w+3,y,Math.min(1,0.4+age*3)*e,1.9); } } }
            const top=cc.y0-rc.y0; if(top>13){ const n=Math.min(3,Math.floor((top-4)/3)); const w=bw*0.56, x0=cxm-w/2; for(let i=0;i<n;i++){ const y=rc.y0+3+i*3; dotted(x0,y,x0+w,y,0.16*e,2); put(x0-2,y,0.25*e,1.4); put(x0+w+3,y,0.5*e,1.9); } }
          }
          boxes.push([Math.max(0,Math.floor(rc.x0)-3),Math.max(0,Math.floor(rc.y0)-3),Math.min(cols-1,Math.ceil(rc.x1)+3),Math.min(rows-1,Math.ceil(rc.y1)+3)]);
        }
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

reg();
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const fine=matchMedia('(pointer: fine)');
let paused=document.documentElement.dataset.motion==='paused';
if(!fine.matches){const field=document.querySelector('canvas[data-scene=touch]');field.removeAttribute('data-scene');field.hidden=true;}
const mounted=window.DotDisplay.mount(document.getElementById('pp-root'),{animate:false});
const D=window.LucaDots;
if(D){
 D.registerScene('recall-slow',(p,t)=>{p.__f=(p.__f||0)+1;if(p.__f%3===0){D.scenes.recall(p,t);for(let i=0;i<p.buf.length;i++)if(p.buf[i]<.24)p.buf[i]*=.62}});
 const seen=new WeakSet();
 const mountPanel=cv=>{if(seen.has(cv))return;seen.add(cv);const panel=D.registerPanel(cv,{seed:cv.dataset.dla,cell:1,breath:true,level:.62});panel.scene='recall-slow';panel.enableMagnitude(D.MAGNITUDE_LUT_INKFLOOR);};
 const sigils=new IntersectionObserver(entries=>{for(const en of entries)if(en.isIntersecting){mountPanel(en.target);sigils.unobserve(en.target)}},{rootMargin:'100px'});
 document.querySelectorAll('canvas[data-dla]').forEach(cv=>sigils.observe(cv));
 D.setMotionPaused(paused);
}
let raf=0,last=0,elapsed=3000,previous=0;
function frame(t){
 raf=requestAnimationFrame(frame);if(t-last<38)return;
 elapsed+=previous?Math.min(80,t-previous):38;previous=t;last=t;
 for(const item of mounted.items)if(item.live&&item.d.ok)item.fn(item.d,elapsed,item.cv);
}
function sync(){
 cancelAnimationFrame(raf);raf=0;previous=0;
 if(!paused&&!document.hidden)raf=requestAnimationFrame(frame);
 if(D)D.setMotionPaused(paused||document.hidden);
}
window.addEventListener('polyphonic:motion',e=>{paused=e.detail.paused;sync()});
document.addEventListener('visibilitychange',sync);
window.addEventListener('pointermove',e=>{if(fine.matches&&!paused){P.x=e.clientX;P.y=e.clientY}},{passive:true});
document.addEventListener('pointerleave',()=>{P.x=-10000;P.y=-10000});
window.addEventListener('pagehide',event=>{cancelAnimationFrame(raf);if(!event.persisted)mounted.stop();if(D)D.setMotionPaused(true)});
window.addEventListener('pageshow',sync);
sync();
})();
