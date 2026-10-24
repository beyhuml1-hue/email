(() => {
  'use strict';
  const ocean = document.querySelector('.ocean');
  const canvas = document.getElementById('ocean-motion');
  if (!canvas || !ocean) return;
  const ctx = canvas.getContext('2d');
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let width=innerWidth, height=innerHeight, scale=1, frame, last=0, pointer={x:.5,y:.5}, drift={x:0,y:0}, ripples=[], lastRipple=0;
  const bubbles=Array.from({length:29},(_,i)=>({x:(i*.61803398875)%1,y:(i*.38196601125)%1,r:2+i%4*1.1,speed:.016+(i%5)*.004,phase:i*1.7}));
  const fish=Array.from({length:5},(_,i)=>({x:(i*.283+.07)%1,y:.16+(i*.19)% .67,size:18+i%3*4,speed:.012+i*.003,phase:i*2.4,direction:i%2?1:-1}));
  function resize(){width=innerWidth;height=innerHeight;scale=Math.min(devicePixelRatio||1,2);canvas.width=width*scale;canvas.height=height*scale;ctx.setTransform(scale,0,0,scale,0,0);}
  function drawFish(x,y,size,direction,phase){
    ctx.save();ctx.translate(x,y);ctx.scale(direction,1);ctx.globalAlpha=.78;
    // Pixel shapes keep the fish in the same visual language as the reef.
    const unit=size/12;ctx.scale(unit,unit);
    ctx.fillStyle='#394e55';ctx.fillRect(-6,-3,10,6);ctx.fillRect(-4,-4,6,8);ctx.fillRect(4,-2,2,4);
    ctx.fillStyle='#e4a063';ctx.fillRect(-5,-2,9,4);ctx.fillRect(-3,-3,5,6);
    ctx.fillStyle='#e9e4c9';ctx.fillRect(-3,-3,1.5,6);ctx.fillRect(1,-2,1.5,4);
    ctx.fillStyle='#384f58';const wag=Math.sin(phase)*.8;ctx.fillRect(6,-3+wag,2,6);ctx.fillRect(5,-2+wag,1,4);
    ctx.fillStyle='#173c4b';ctx.fillRect(-5,-1,1,1);ctx.restore();
  }
  function render(now){
    const t=now/1000,dt=Math.min((now-last)/1000||0,.05);last=now;
    ctx.clearRect(0,0,width,height);
    if(preference.matches){ocean.style.setProperty('--water-x','0px');ocean.style.setProperty('--water-y','0px');return;}
    drift.x+=((pointer.x-.5)*14-drift.x)*.045;drift.y+=((pointer.y-.5)*10-drift.y)*.045;
    ocean.style.setProperty('--water-x',`${drift.x+Math.sin(t*.13)*2}px`);ocean.style.setProperty('--water-y',`${drift.y+Math.cos(t*.15)*1.5}px`);
    for(const b of bubbles){
      b.y-=dt*b.speed;if(b.y<-.03)b.y=1.03;
      const x=b.x*width+Math.sin(t*.7+b.phase)*13+drift.x*1.7,y=b.y*height;
      ctx.beginPath();ctx.arc(x,y,b.r,0,Math.PI*2);ctx.strokeStyle='rgba(221,255,255,.36)';ctx.lineWidth=1;ctx.stroke();
      ctx.beginPath();ctx.arc(x-b.r*.3,y-b.r*.35,Math.max(.6,b.r*.2),0,Math.PI*2);ctx.fillStyle='rgba(240,255,255,.7)';ctx.fill();
    }
    for(const f of fish){
      f.x+=dt*f.speed*f.direction;if(f.x>1.08)f.x=-.08;if(f.x<-.08)f.x=1.08;
      const x=f.x*width+drift.x*2;
      const near=Math.max(0,1-Math.abs(x-pointer.x*width)/220);
      const y=f.y*height+Math.sin(t*.75+f.phase)*15+(pointer.y-.5)*near*28;
      drawFish(x,y,f.size,-f.direction,t*7+f.phase);
    }
    ripples=ripples.filter(r=>t-r.start<1.7);
    for(const r of ripples){const age=t-r.start;ctx.beginPath();ctx.ellipse(r.x,r.y,10+age*60,4+age*25,0,0,Math.PI*2);ctx.strokeStyle=`rgba(217,255,247,${(1-age/1.7)*.23})`;ctx.lineWidth=1.2;ctx.stroke();}
    frame=requestAnimationFrame(render);
  }
  let lastMove=0;
  addEventListener('pointermove',event=>{
    if(event.pointerType==='touch'||preference.matches)return;
    pointer.x=event.clientX/width;pointer.y=event.clientY/height;
    const now=performance.now();if(now-lastRipple>110&&Math.hypot(event.clientX-lastMove, event.movementY)>3){ripples.push({x:event.clientX,y:event.clientY,start:now/1000});lastRipple=now;}lastMove=event.clientX;
  },{passive:true});
  document.documentElement.addEventListener('pointerleave',()=>{pointer={x:.5,y:.5};});
  const card=document.querySelector('.auth-card');
  card?.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch'||preference.matches)return;
    const rect=card.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height;
    card.style.setProperty('--card-rotate-x',`${(y-.5)*-2.5}deg`);card.style.setProperty('--card-rotate-y',`${(x-.5)*3}deg`);
    card.style.setProperty('--glow-x',`${x*100}%`);card.style.setProperty('--glow-y',`${y*100}%`);
  },{passive:true});
  card?.addEventListener('pointerleave',()=>{card.style.setProperty('--card-rotate-x','0deg');card.style.setProperty('--card-rotate-y','0deg');card.style.setProperty('--glow-x','50%');card.style.setProperty('--glow-y','50%');});
  function restart(){cancelAnimationFrame(frame);last=performance.now();frame=requestAnimationFrame(render);}
  preference.addEventListener('change',restart);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelAnimationFrame(frame);else restart();});
  addEventListener('resize',resize,{passive:true});resize();restart();
})();
