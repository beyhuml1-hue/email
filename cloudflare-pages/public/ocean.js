/* Live WebGL voxel reef. Geometry, materials and motion are generated in code.
   No scene images, texture files, downloaded models or rendering libraries. */
(() => {
  'use strict';
  const canvas=document.getElementById('ocean-motion');
  if(!canvas)return;
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true});
  if(!gl){canvas.dataset.renderer='unavailable';return;}
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const rippleCanvas=document.createElement('canvas');rippleCanvas.id='water-ripples';rippleCanvas.setAttribute('aria-hidden','true');canvas.after(rippleCanvas);
  const water=rippleCanvas.getContext('2d');
  let width=innerWidth,height=innerHeight,dpr=1,frame,last=0,elapsed=0,px=0,py=0,mx=0,my=0,ripples=[],lastRipple=0;
  const halfH=13,halfW=halfH*1912/942;
  const yaw=Math.atan2(15,25),elevation=Math.atan2(20,Math.hypot(15,25));
  const side=[Math.cos(yaw),0,-Math.sin(yaw)],forward=[Math.sin(yaw),0,Math.cos(yaw)];
  function at(nx,ny,y=0){const a=(nx-.5)*halfW*2,b=((.5-ny)*halfH*2+(4-y)*Math.cos(elevation))/-Math.sin(elevation);return [side[0]*a+forward[0]*b,y,side[2]*a+forward[2]*b];}
  const vertex=`
    attribute vec3 aPosition,aNormal,aColor;
    uniform mat4 uViewProjection,uModel;
    uniform float uTime,uKind;
    varying vec3 vWorld,vNormal,vColor;
    void main(){
      vec3 p=aPosition;
      if(uKind>2.5&&uKind<3.5){float bend=max(p.y,0.);p.x+=sin(uTime*1.35+p.y*1.25+uModel[3].x)*bend*bend*.035;p.z+=cos(uTime+p.y)*bend*.04;}
      if(uKind>1.5&&uKind<2.5){p.z+=sin(uTime*8.0-p.x*5.0)*max(p.x-.15,0.)*.26;}
      vec4 w=uModel*vec4(p,1.);vWorld=w.xyz;vNormal=normalize(mat3(uModel)*aNormal);vColor=aColor;gl_Position=uViewProjection*w;
    }`;
  const fragment=`
    precision highp float;
    varying vec3 vWorld,vNormal,vColor;
    uniform vec3 uEye; uniform vec2 uResolution;
    uniform float uTime,uKind;
    float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
    void main(){
      float sunlight=max(dot(normalize(vNormal),normalize(vec3(-.6,1.,.35))),0.);
      float grain=1.+(hash(floor(vWorld*7.0+vNormal*.02))-.5)*.18;
      float current=sin(vWorld.x*1.4+uTime*.7+sin(vWorld.z*1.6-uTime*.4))*sin(vWorld.z*1.1+uTime*.35);
      vec3 color=vColor*(.67+sunlight*.4)*grain+vec3(.025,.065,.065)*current;
      float nearLight=exp(-length(vWorld.xz)*.7)*max(0.,1.-abs(vWorld.y-1.4)*.25);
      color+=vec3(.015,.11,.11)*nearLight*(.8+sin(uTime*1.4)*.2);
      if(uKind>.5&&uKind<1.5)color+=vColor*.3;
      float distance=length(uEye-vWorld),fog=smoothstep(28.,75.,distance);
      color=mix(color,vec3(.30,.64,.71),fog*.78);
      float alpha=1.-smoothstep(48.,75.,distance); if(uKind>3.5)alpha*=1.-smoothstep(.60,.82,gl_FragCoord.y/uResolution.y); gl_FragColor=vec4(color,alpha);
    }`;
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  function program(v,f){const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,v));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
  const main=program(vertex,fragment);
  const attributes=['aPosition','aNormal','aColor'].map(n=>gl.getAttribLocation(main,n));
  const uniform=Object.fromEntries(['uViewProjection','uModel','uTime','uKind','uEye','uResolution'].map(n=>[n,gl.getUniformLocation(main,n)]));
  const rgb=hex=>[parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255];
  const color={sand:rgb('#b9b59b'),stone:rgb('#93bab6'),purple:rgb('#a585c3'),blue:rgb('#4075ba'),red:rgb('#b57880'),orange:rgb('#b58d70'),yellow:rgb('#b7c484'),leaf:rgb('#56a55e'),stem:rgb('#419854'),teal:rgb('#79cfce'),glow:rgb('#a2f2e3')};
  const faces=[[[1,0,0],[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]],[[-1,0,0],[[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]],[[0,1,0],[[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]],[[0,-1,0],[[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]],[[0,0,1],[[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,1]]],[[0,0,-1],[[-1,-1,-1],[-1,1,-1],[1,1,-1],[1,-1,-1]]]];
  function cube(data,x,y,z,sx,sy,sz,c,topOnly=false){for(let f=0;f<6;f++){if(topOnly&&f!==2)continue;const[n,points]=faces[f];for(const index of [0,1,2,0,2,3]){const q=points[index];data.push(x+q[0]*sx/2,y+q[1]*sy/2,z+q[2]*sz/2,...n,...c);}}}
  function mesh(data,kind=0){const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);return {buffer,count:data.length/9,kind};}
  function transform(x=0,y=0,z=0,angle=0,size=1){const c=Math.cos(angle)*size,s=Math.sin(angle)*size;return new Float32Array([c,0,-s,0,0,size,0,0,s,0,c,0,x,y,z,1]);}
  function multiply(a,b){const out=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];return out;}
  const normalize=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  function lookAt(eye,target){const f=normalize(target.map((v,i)=>v-eye[i])),s=normalize(cross(f,[0,1,0])),u=cross(s,f);return new Float32Array([s[0],u[0],-f[0],0,s[1],u[1],-f[1],0,s[2],u[2],-f[2],0,-dot(s,eye),-dot(u,eye),dot(f,eye),1]);}
  function ortho(w,h){return new Float32Array([1/w,0,0,0,0,1/h,0,0,0,0,-2/119,0,0,0,-121/119,1]);}
  const reefData=[],objects=[],reefSpots=[];
  function platform(nx,ny,size=1){const p=at(nx,ny);reefSpots.push(p);for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)cube(reefData,p[0]+x*.66*size,.18*size,p[2]+z*.66*size,.65*size,.36*size,.65*size,color.stone);return p;}
  function coral(nx,ny,palette,size=1,shape=0){const p=at(nx,ny);reefSpots.push(p);const c=color[palette];for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++){if(shape===1&&x===0&&z===0)continue;cube(reefData,p[0]+x*.42*size,.22*size,p[2]+z*.42*size,.42*size,.44*size,.42*size,c);}for(const[x,z,h]of [[-1,-1,1.25],[1,0,.83],[0,1,1.7],[0,0,shape?1.1:1.6]])cube(reefData,p[0]+x*.42*size,(h*.5+.25)*size,p[2]+z*.42*size,.42*size,h*size,.42*size,c);}
  platform(.25,.72,1.45);platform(.72,.78,1.45);
  coral(.19,.84,'blue',1.55);coral(.40,.81,'purple',1.05);coral(.55,.77,'red',1.35,1);coral(.90,.73,'purple',1.2);
  coral(.12,.70,'orange',1.32);coral(.13,.66,'purple',.78);coral(.27,.70,'purple',1.1);coral(.39,.58,'purple',1.2);coral(.36,.60,'yellow',1.1);
  coral(.66,.65,'yellow',1.2);coral(.68,.70,'red',1.25);coral(.74,.71,'purple',.9);coral(.84,.89,'orange',1.35);
  const slab=at(.375,.30,7.2);cube(reefData,slab[0],slab[1],slab[2],4.2,.65,2.9,color.stone);
  // Conduit pedestal, upright frame and independently rotating core.
  for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++){if(Math.abs(x)+Math.abs(z)>3)continue;cube(reefData,x*.67,.16,z*.67,.66,.32,.66,color.teal);}
  cube(reefData,0,.52,0,1.4,.4,1.4,color.stone);
  cube(reefData,-.52,1.62,0,.14,1.7,.25,color.teal);cube(reefData,.52,1.62,0,.14,1.7,.25,color.teal);
  cube(reefData,0,2.42,0,1.18,.14,.25,color.teal);cube(reefData,0,.83,0,1.18,.14,.25,color.teal);
  const gem=[];cube(gem,0,0,0,.6,.9,.6,color.glow);const core=mesh(gem,1),reef=mesh(reefData);
  const floor=[];
  for(let x=-60;x<=60;x++)for(let z=-60;z<=60;z++){
    const tx=x*.65,tz=z*.65;let shade=.93+((Math.sin(x*172.7+z*37.2)*43758.5)%1)*.04;
    for(const p of reefSpots){const distance=Math.hypot(tx-p[0]-.4,tz-p[2]-.5);if(distance<1.9)shade*=.80+.2*distance/1.9;}
    cube(floor,tx,-.1,tz,.638,.12,.638,color.sand.map(v=>v*shade),true);
  }
  const seabed=mesh(floor,4);
  for(const[nx,ny,size]of [[.08,.88,1.4],[.17,.56,1.35],[.18,.62,1.0],[.41,.50,1.3],[.86,.64,1.4],[.93,.80,1.6],[.58,1.04,1.3],[.72,.96,1.35],[.81,.58,1.5]]){
    const p=at(nx,ny),data=[];for(let i=0;i<10;i++){cube(data,0,i*.26*size,0,.12*size,.28*size,.12*size,color.stem);if(i%2===0)cube(data,(i%4===0?1:-1)*.18*size,i*.26*size,0,.35*size,.10*size,.12*size,color.leaf);}
    objects.push({mesh:mesh(data,3),matrix:transform(...p)});
  }
  const fishData=[],orange=rgb('#dc914c'),cream=rgb('#eee9cc'),dark=rgb('#274959');
  cube(fishData,0,0,0,.75,.38,.2,orange);cube(fishData,-.12,0,0,.42,.52,.2,orange);
  for(const x of [-.22,.18])cube(fishData,x,0,0,.09,.47,.24,cream);
  cube(fishData,.55,0,0,.18,.4,.10,orange);cube(fishData,.4,0,0,.16,.14,.12,dark);
  cube(fishData,-.34,.07,.115,.05,.06,.025,dark);cube(fishData,-.34,.07,-.115,.05,.06,.025,dark);
  cube(fishData,0,.3,0,.3,.1,.06,dark);cube(fishData,0,-.27,0,.22,.1,.06,orange);
  const clownfish=mesh(fishData,2),blueData=[];
  cube(blueData,0,0,0,.66,.4,.23,rgb('#557fc9'));cube(blueData,.47,0,0,.16,.36,.09,rgb('#486eab'));cube(blueData,-.26,.08,.13,.06,.06,.04,dark);const blueFish=mesh(blueData,2);
  const fish=[];
  for(const[nx,ny,size,blue]of [[.035,.13,1.8,0],[.065,.46,.9,0],[.08,.58,.75,0],[.40,.49,.95,0],[.36,.29,.9,1],[.34,.32,.85,1],[.15,.70,.8,0],[.7,.25,.9,1],[.94,.43,1.15,0]])fish.push({origin:at(nx,ny,4.5),size,mesh:blue?blueFish:clownfish,phase:fish.length*1.9});
  const pointProgram=program(`attribute vec3 aPosition;attribute float aSize;uniform mat4 uViewProjection;uniform float uPixelScale;void main(){gl_Position=uViewProjection*vec4(aPosition,1.);gl_PointSize=aSize*uPixelScale;}`,`precision mediump float;void main(){vec2 p=gl_PointCoord-.5;float r=length(p);if(r>.49)discard;float ring=smoothstep(.34,.44,r)*(1.-smoothstep(.44,.49,r));float shine=exp(-length(p-vec2(-.17,.18))*22.);gl_FragColor=vec4(.78,.98,1.,ring*.28+shine*.44);}`);
  const pointPosition=gl.getAttribLocation(pointProgram,'aPosition'),pointSize=gl.getAttribLocation(pointProgram,'aSize'),pointBuffer=gl.createBuffer();
  const pointVP=gl.getUniformLocation(pointProgram,'uViewProjection'),pointScale=gl.getUniformLocation(pointProgram,'uPixelScale');
  const bubbles=Array.from({length:65},(_,i)=>({x:Math.sin(i*7.3)*23,z:Math.cos(i*4.8)*18,y:(i*1.37)%18,size:i%7===0?36:5+i%5*2}));
  function draw(object,matrix=transform()){
    gl.bindBuffer(gl.ARRAY_BUFFER,object.buffer);for(let i=0;i<3;i++){gl.enableVertexAttribArray(attributes[i]);gl.vertexAttribPointer(attributes[i],3,gl.FLOAT,false,36,i*12);}
    gl.uniformMatrix4fv(uniform.uModel,false,matrix);gl.uniform1f(uniform.uKind,object.kind);gl.drawArrays(gl.TRIANGLES,0,object.count);
  }
  function resize(){width=innerWidth;height=innerHeight;dpr=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);rippleCanvas.width=canvas.width;rippleCanvas.height=canvas.height;water.setTransform(dpr,0,0,dpr,0,0);gl.viewport(0,0,canvas.width,canvas.height);}
  function render(now){
    const dt=Math.min((now-last)/1000||0,.05);last=now;if(!reduced.matches)elapsed+=dt;
    mx+=(px-mx)*.045;my+=(py-my)*.045;
    const motion=reduced.matches?0:1,t=elapsed*motion,angle=yaw+mx*.09*motion,tilt=elevation+my*.035*motion;
    const distance=35,eye=[Math.sin(angle)*Math.cos(tilt)*distance,4+Math.sin(tilt)*distance,Math.cos(angle)*Math.cos(tilt)*distance];
    const viewHeight=halfH,vp=multiply(ortho(viewHeight*width/height,viewHeight),lookAt(eye,[0,4,0]));
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.useProgram(main);
    gl.uniformMatrix4fv(uniform.uViewProjection,false,vp);gl.uniform3fv(uniform.uEye,eye);gl.uniform2f(uniform.uResolution,canvas.width,canvas.height);gl.uniform1f(uniform.uTime,t);
    draw(seabed);draw(reef);for(const object of objects)draw(object.mesh,object.matrix);
    draw(core,transform(0,1.62+Math.sin(t*1.4)*.13,0,t*.22,.86+Math.sin(t*1.4)*.04));
    for(const f of fish){const phase=t*.25+f.phase,x=f.origin[0]+Math.sin(phase)*2.2,z=f.origin[2]+Math.cos(phase)*1.2,y=f.origin[1]+Math.sin(t*.8+f.phase)*.2,direction=Math.atan2(-Math.sin(phase)*1.2,Math.cos(phase)*2.2);draw(f.mesh,transform(x,y,z,-direction,f.size));}
    gl.useProgram(pointProgram);const points=[];for(const b of bubbles)points.push(b.x+Math.sin(t*.35+b.z)*.35,((b.y+t*.38)%20)-1,b.z,b.size);
    gl.bindBuffer(gl.ARRAY_BUFFER,pointBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points),gl.DYNAMIC_DRAW);
    for(const a of attributes)gl.disableVertexAttribArray(a);
    gl.enableVertexAttribArray(pointPosition);gl.vertexAttribPointer(pointPosition,3,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(pointSize);gl.vertexAttribPointer(pointSize,1,gl.FLOAT,false,16,12);
    gl.uniformMatrix4fv(pointVP,false,vp);gl.uniform1f(pointScale,dpr);gl.depthMask(false);gl.drawArrays(gl.POINTS,0,bubbles.length);gl.depthMask(true);gl.disableVertexAttribArray(pointPosition);gl.disableVertexAttribArray(pointSize);
    water.clearRect(0,0,width,height);ripples=ripples.filter(r=>now-r.start<1700);for(const r of ripples){const age=(now-r.start)/1000;water.beginPath();water.ellipse(r.x,r.y,8+age*65,4+age*28,0,0,Math.PI*2);water.strokeStyle=`rgba(222,255,246,${(1-age/1.7)*.3})`;water.stroke();}
    canvas.dataset.renderer='webgl';canvas.dataset.scene='voxel-reef';canvas.dataset.cameraX=mx.toFixed(3);
    if(!reduced.matches)frame=requestAnimationFrame(render);
  }
  function restart(){cancelAnimationFrame(frame);last=performance.now();frame=requestAnimationFrame(render);}
  addEventListener('pointermove',event=>{if(reduced.matches||event.pointerType==='touch')return;px=event.clientX/width*2-1;py=event.clientY/height*2-1;const now=performance.now();if(now-lastRipple>90){ripples.push({x:event.clientX,y:event.clientY,start:now});lastRipple=now;}},{passive:true});
  document.documentElement.addEventListener('pointerleave',()=>{px=py=0;});
  const card=document.querySelector('.auth-card');card?.addEventListener('pointermove',event=>{if(reduced.matches)return;const r=card.getBoundingClientRect(),x=(event.clientX-r.left)/r.width,y=(event.clientY-r.top)/r.height;card.style.setProperty('--card-rotate-x',`${(y-.5)*-2}deg`);card.style.setProperty('--card-rotate-y',`${(x-.5)*2}deg`);},{passive:true});
  card?.addEventListener('pointerleave',()=>{card.style.setProperty('--card-rotate-x','0deg');card.style.setProperty('--card-rotate-y','0deg');});
  addEventListener('resize',()=>{resize();if(reduced.matches)restart();},{passive:true});
  document.addEventListener('visibilitychange',()=>document.hidden?cancelAnimationFrame(frame):restart());reduced.addEventListener('change',restart);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();cancelAnimationFrame(frame);});canvas.addEventListener('webglcontextrestored',()=>location.reload());
  resize();restart();
})();
