/* Live WebGL voxel reef. Geometry, materials and motion are generated in code.
   No scene images, texture files, downloaded models or rendering libraries. */
(() => {
  'use strict';
  const canvas=document.getElementById('ocean-motion');
  if(!canvas)return;
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true});
  if(!gl){canvas.dataset.renderer='unavailable';return;}
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let width=innerWidth,height=innerHeight,dpr=1,frame,last=0,elapsed=0,px=0,py=0,mx=0,my=0;
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
    uniform vec3 uEye,uFog; uniform vec2 uResolution; uniform float uBiome;
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
      if(uBiome>1.5&&uBiome<2.5&&vColor.r>vColor.g*1.5)color+=vColor*(.3+sin(uTime+vWorld.x)*.08); color=mix(color,uFog,fog*.65);
      float alpha=1.-smoothstep(48.,75.,distance); if(uKind>3.5)alpha*=1.-smoothstep(.60,.82,gl_FragCoord.y/uResolution.y); gl_FragColor=vec4(color,alpha);
    }`;
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  function program(v,f){const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,v));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
  const main=program(vertex,fragment);
  const attributes=['aPosition','aNormal','aColor'].map(n=>gl.getAttribLocation(main,n));
  const uniform=Object.fromEntries(['uViewProjection','uModel','uTime','uKind','uEye','uResolution','uFog','uBiome'].map(n=>[n,gl.getUniformLocation(main,n)]));
  const rgb=hex=>[parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255];
  const baseColor={sand:rgb('#b9b59b'),stone:rgb('#93bab6'),purple:rgb('#a585c3'),blue:rgb('#4075ba'),red:rgb('#b57880'),orange:rgb('#b58d70'),yellow:rgb('#b7c484'),leaf:rgb('#56a55e'),stem:rgb('#419854'),teal:rgb('#79cfce'),glow:rgb('#a2f2e3')};
  let color={...baseColor};
  const sceneBuffers=[];
  const faces=[[[1,0,0],[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]],[[-1,0,0],[[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]],[[0,1,0],[[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]],[[0,-1,0],[[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]],[[0,0,1],[[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,1]]],[[0,0,-1],[[-1,-1,-1],[-1,1,-1],[1,1,-1],[1,-1,-1]]]];
  function cube(data,x,y,z,sx,sy,sz,c,topOnly=false){for(let f=0;f<6;f++){if(topOnly&&f!==2)continue;const[n,points]=faces[f];for(const index of [0,1,2,0,2,3]){const q=points[index];data.push(x+q[0]*sx/2,y+q[1]*sy/2,z+q[2]*sz/2,...n,...c);}}}
  function mesh(data,kind=0){const buffer=gl.createBuffer();sceneBuffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);return {buffer,count:data.length/9,kind};}
  function transform(x=0,y=0,z=0,angle=0,size=1){const c=Math.cos(angle)*size,s=Math.sin(angle)*size;return new Float32Array([c,0,-s,0,0,size,0,0,s,0,c,0,x,y,z,1]);}
  function multiply(a,b){const out=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];return out;}
  const normalize=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  function lookAt(eye,target){const f=normalize(target.map((v,i)=>v-eye[i])),s=normalize(cross(f,[0,1,0])),u=cross(s,f);return new Float32Array([s[0],u[0],-f[0],0,s[1],u[1],-f[1],0,s[2],u[2],-f[2],0,-dot(s,eye),-dot(u,eye),dot(f,eye),1]);}
  function ortho(w,h){return new Float32Array([1/w,0,0,0,0,1/h,0,0,0,0,-2/119,0,0,0,-121/119,1]);}
  let reefData=[],objects=[],reefSpots=[],seabed,reef,core,fish=[],bubbles=[],biome='ocean',biomeId=0;
  const configs={ocean:{id:0,sky:['#8bcbd8','#278bb7','#adb39a'],floor:'#b9b59b',fog:'#4da3b5',particle:'#c7faff'},grass:{id:1,sky:['#b8d9e3','#9bc6bd','#739b58'],floor:'#79a05f',fog:'#a1bfb0',particle:'#e9eaa3'},nether:{id:2,sky:['#261e2a','#563036','#6e3c32'],floor:'#693d3f',fog:'#6a3d42',particle:'#f8a05e'},end:{id:3,sky:['#151525','#33233e','#4d3555'],floor:'#d7d4a1',fog:'#493551',particle:'#cb9af3'},desert:{id:4,sky:['#c1dce4','#d5cfaa','#d9b985'],floor:'#d9bd84',fog:'#c8b895',particle:'#ead4a1'},snow:{id:5,sky:['#b9d2dd','#9ebac6','#dce8e5'],floor:'#e0eae5',fog:'#c1d6dc',particle:'#ffffff'},cherry:{id:6,sky:['#d5d6ed','#dcb6c9','#a9b48c'],floor:'#94ac79',fog:'#d7bbc9',particle:'#f1b6cf'},mushroom:{id:7,sky:['#b5c9c7','#a7b6ac','#8c9b89'],floor:'#9b9c8b',fog:'#b0bdb4',particle:'#dfd8b4'}};
  function platform(nx,ny,size=1){const p=at(nx,ny);reefSpots.push(p);for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)cube(reefData,p[0]+x*.66*size,.18*size,p[2]+z*.66*size,.65*size,.36*size,.65*size,color.stone);return p;}
  function coral(nx,ny,palette,size=1,shape=0){const p=at(nx,ny);reefSpots.push(p);const c=color[palette];for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++){if(shape===1&&x===0&&z===0)continue;cube(reefData,p[0]+x*.42*size,.22*size,p[2]+z*.42*size,.42*size,.44*size,.42*size,c);}for(const[x,z,h]of [[-1,-1,1.25],[1,0,.83],[0,1,1.7],[0,0,shape?1.1:1.6]])cube(reefData,p[0]+x*.42*size,(h*.5+.25)*size,p[2]+z*.42*size,.42*size,h*size,.42*size,c);}

  function tree(nx,ny,tone,size=1){const p=at(nx,ny),data=[];cube(data,0,1.2*size,0,.36*size,2.5*size,.36*size,rgb('#886a51'));for(const[x,y,z,w]of [[0,3,0,1.7],[-.7,2.7,0,1.2],[.7,2.8,.2,1.4],[0,3.5,.2,1.2],[0,2.8,-.7,1.2]])cube(data,x*size,y*size,z*size,w*size,.65*size,w*size,rgb(tone));objects.push({mesh:mesh(data,3),matrix:transform(...p)});reefSpots.push(p);}
  function cactus(nx,ny,size=1){const p=at(nx,ny),data=[];cube(data,0,1.1*size,0,.45*size,2.2*size,.45*size,rgb('#548d5b'));cube(data,-.5*size,1.1*size,0,.7*size,.35*size,.35*size,rgb('#659b65'));cube(data,-.8*size,1.5*size,0,.35*size,.9*size,.35*size,rgb('#659b65'));cube(data,.6*size,1.7*size,0,.8*size,.35*size,.35*size,rgb('#4e8257'));cube(data,.9*size,2*size,0,.35*size,.9*size,.35*size,rgb('#4e8257'));objects.push({mesh:mesh(data,3),matrix:transform(...p)});reefSpots.push(p);}
  function mushroom(nx,ny,tone,size=1){const p=at(nx,ny),data=[];cube(data,0,.8*size,0,.45*size,1.6*size,.45*size,rgb('#d4c7aa'));cube(data,0,1.6*size,0,2*size,.5*size,1.8*size,rgb(tone));cube(data,0,1.95*size,0,1.4*size,.25*size,1.3*size,rgb(tone));for(const[x,z]of [[-.5,-.4],[.4,.3],[.4,-.4],[-.4,.4]])cube(data,x*size,1.88*size,z*size,.22*size,.04*size,.23*size,rgb('#eee6cf'));objects.push({mesh:mesh(data,3),matrix:transform(...p)});reefSpots.push(p);}
  function buildScene(name){
    if(!configs[name])return;for(const buffer of sceneBuffers)gl.deleteBuffer(buffer);sceneBuffers.length=0;
    biome=name;biomeId=configs[name].id;reefData=[];objects=[];reefSpots=[];fish=[];
    const cfg=configs[name];document.querySelector('.ocean').style.background=`linear-gradient(180deg,${cfg.sky[0]},${cfg.sky[1]} 52%,${cfg.sky[2]})`;
    document.documentElement.dataset.biome=name;color={...baseColor,sand:rgb(cfg.floor)};
    if(name==='ocean'){
      platform(.25,.72,1.45);platform(.72,.78,1.45);
      for(const[nx,ny,tone,size]of [[.19,.84,'blue',1.55],[.40,.81,'purple',1.05],[.55,.77,'red',1.35],[.90,.73,'purple',1.2],[.12,.70,'orange',1.32],[.13,.66,'purple',.78],[.27,.70,'purple',1.1],[.39,.58,'purple',1.2],[.36,.60,'yellow',1.1],[.66,.65,'yellow',1.2],[.68,.70,'red',1.25],[.84,.89,'orange',1.35]])coral(nx,ny,tone,size);
      const slab=at(.375,.30,7.2);cube(reefData,...slab,4.2,.65,2.9,color.stone);
      for(const[nx,ny,size]of [[.08,.88,1.4],[.17,.56,1.35],[.18,.62,1.0],[.41,.50,1.3],[.86,.64,1.4],[.93,.80,1.6],[.58,1.04,1.3],[.72,.96,1.35]]){const p=at(nx,ny),data=[];for(let i=0;i<10;i++){cube(data,0,i*.26*size,0,.12*size,.28*size,.12*size,color.stem);if(i%2===0)cube(data,(i%4===0?1:-1)*.18*size,i*.26*size,0,.35*size,.10*size,.12*size,color.leaf);}objects.push({mesh:mesh(data,3),matrix:transform(...p)});}
    }else if(name==='grass'||name==='cherry'){
      for(const[x,y,size]of [[.08,.58,1.2],[.21,.88,.9],[.42,.49,1.1],[.76,.68,1.25],[.94,.85,1.4]])tree(x,y,name==='cherry'?'#d994b3':'#619458',size);
      for(const[x,y]of [[.33,.74],[.58,.80],[.88,.64],[.13,.78]]){const p=at(x,y);for(let i=0;i<5;i++){const c=i%2?rgb('#e9cf77'):rgb(name==='cherry'?'#f4b8cd':'#c5b4d5');cube(reefData,p[0]+i*.24,.2+Math.sin(i)*.08,p[2]+Math.cos(i)*.3,.12,.5,.12,rgb('#6a9c60'));cube(reefData,p[0]+i*.24,.47+Math.sin(i)*.08,p[2]+Math.cos(i)*.3,.3,.15,.3,c);}}
    }else if(name==='nether'){
      color.stone=rgb('#413c4b');color.teal=rgb('#8c443e');color.glow=rgb('#f7b36c');
      for(const[x,y,h]of [[.08,.70,3.1],[.24,.87,1.8],[.40,.55,3.8],[.74,.64,3.5],[.94,.84,4.2],[.59,.90,1.4]]){const p=at(x,y);reefSpots.push(p);for(let j=0;j<3;j++)cube(reefData,p[0]+j*.5,h*.5-j*.3,p[2]+j*.15,.55,h-j*.6,.65,rgb(j%2?'#684349':'#413c4b'));}
      mushroom(.14,.65,'#408b89',1.4);mushroom(.86,.76,'#a24752',1.3);
    }else if(name==='end'){
      color.stone=rgb('#373044');color.teal=rgb('#665382');color.glow=rgb('#d3a0fc');
      for(const[x,y,h]of [[.13,.76,3.3],[.32,.85,2.1],[.76,.68,4.4],[.93,.86,3.1]]){const p=at(x,y);cube(reefData,p[0],h/2,p[2],.8,h,.8,rgb('#3b3346'));const gem=[];cube(gem,0,0,0,.55,.9,.55,rgb('#c49be1'));objects.push({mesh:mesh(gem,1),origin:[p[0],h+.65,p[2]],bob:.18,spin:.5});}
      for(const[x,y]of [[.34,.32],[.66,.38]]){const p=at(x,y,5.5),data=[];cube(data,0,0,0,3,.5,2.3,color.sand);cube(data,.3,-.5,0,1.8,.7,1.4,color.stone);objects.push({mesh:mesh(data),origin:p,bob:.18,spin:.018});}
    }else if(name==='desert'){
      color.stone=rgb('#c8ac7e');color.teal=rgb('#c8b18c');color.glow=rgb('#edd7a1');
      for(const[x,y,size]of [[.10,.78,1.5],[.27,.65,1],[.75,.62,1.3],[.94,.84,1.8]])cactus(x,y,size);
      for(const[x,y]of [[.39,.79],[.67,.87],[.15,.58]]){const p=at(x,y);for(let j=0;j<3;j++)cube(reefData,p[0]+j*.4,.2+j*.15,p[2],.7,.4+j*.3,.7,rgb('#d5b783'));}
      const weed=[];for(let i=0;i<10;i++)cube(weed,Math.sin(i*2)*.36,Math.cos(i*2)*.36,Math.sin(i*3)*.3,.11,.4,.1,rgb('#a48b5c'));objects.push({mesh:mesh(weed),origin:at(.35,.76,.4),bob:.12,spin:1.2});
    }else if(name==='snow'){
      color.stone=rgb('#b9cfce');color.teal=rgb('#96c6d2');color.glow=rgb('#d4f3f9');
      for(const[x,y,size]of [[.08,.78,1.3],[.29,.65,1],[.73,.62,1.4],[.94,.85,1.8]]){const p=at(x,y),data=[];cube(data,0,.7,0,.3,1.5,.3,rgb('#817365'));for(let i=0;i<4;i++){const w=(2.2-i*.43)*size;cube(data,0,1+i*.55*size,0,w,.6*size,w,rgb(i%2?'#d7e5df':'#698d83'));}objects.push({mesh:mesh(data,3),matrix:transform(...p)});reefSpots.push(p);}
      for(const[x,y]of [[.4,.81],[.57,.75]]){const p=at(x,y);cube(reefData,p[0],.35,p[2],1.1,.7,1.1,color.stone);cube(reefData,p[0],.75,p[2],1.13,.15,1.13,color.sand);}
    }else{
      color.stone=rgb('#a6aaa0');color.teal=rgb('#8faaa2');color.glow=rgb('#e1e4b9');
      for(const[x,y,size]of [[.08,.76,1.5],[.25,.66,1.1],[.4,.82,1],[.75,.68,1.5],[.94,.86,1.7]])mushroom(x,y,x>.5?'#ae6e69':'#a68b78',size);
    }
    for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++){if(Math.abs(x)+Math.abs(z)>3)continue;cube(reefData,x*.67,.16,z*.67,.66,.32,.66,color.teal);}
    cube(reefData,0,.52,0,1.4,.4,1.4,color.stone);
    cube(reefData,-.52,1.62,0,.14,1.7,.25,color.teal);cube(reefData,.52,1.62,0,.14,1.7,.25,color.teal);cube(reefData,0,2.42,0,1.18,.14,.25,color.teal);cube(reefData,0,.83,0,1.18,.14,.25,color.teal);
    const gem=[];cube(gem,0,0,0,.6,.9,.6,color.glow);core=mesh(gem,1);reef=mesh(reefData);
    const floor=[];for(let x=-60;x<=60;x++)for(let z=-60;z<=60;z++){
      const tx=x*.65,tz=z*.65;if(name==='end'&&!(Math.hypot(tx,tz)<7||Math.hypot(tx+12,tz-10)<6||Math.hypot(tx-15,tz+9)<7||Math.hypot(tx+18,tz+17)<5))continue;
      let shade=.93+((Math.sin(x*172.7+z*37.2)*43758.5)%1)*.04;for(const p of reefSpots){const distance=Math.hypot(tx-p[0]-.4,tz-p[2]-.5);if(distance<1.9)shade*=.80+.2*distance/1.9;}
      const lava=name==='nether'&&Math.sin(x*.13+Math.sin(z*.18)*3)>.68;
      cube(floor,tx,name==='end'?-.5:-.1,tz,.638,name==='end'?1:.12,.638,(lava?rgb('#dc7444'):color.sand).map(v=>v*shade),name!=='end');
    }seabed=mesh(floor,4);
    if(name==='ocean'||name==='grass'||name==='cherry'){
      const data=[],fishTone=rgb(name==='ocean'?'#e0934d':'#dbbd59'),cream=rgb('#eee9cc'),dark=rgb('#334752');
      cube(data,0,0,0,.75,.38,.2,fishTone);cube(data,-.12,0,0,.42,.52,.2,fishTone);for(const x of [-.22,.18])cube(data,x,0,0,.09,.47,.24,name==='ocean'?cream:dark);cube(data,.55,0,0,.18,.4,.10,fishTone);cube(data,-.34,.07,.115,.05,.06,.025,dark);
      if(name!=='ocean'){cube(data,.2,.26,.2,.3,.06,.3,cream);cube(data,.2,.26,-.2,.3,.06,.3,cream);}
      const swimmer=mesh(data,2);for(const[nx,ny,size]of [[.035,.13,1.5],[.065,.46,.8],[.4,.49,.8],[.36,.29,.7],[.7,.25,.8],[.94,.43,1]])fish.push({origin:at(nx,ny,4.5),size,mesh:swimmer,phase:fish.length*1.9});
    }
    bubbles=Array.from({length:name==='ocean'?65:85},(_,i)=>({x:Math.sin(i*7.3)*23,z:Math.cos(i*4.8)*18,y:(i*1.37)%18,size:name==='ocean'?(i%7===0?36:5+i%5*2):(name==='snow'||name==='cherry'?5+i%4*2:3+i%3*2)}));
  }
  const pointProgram=program(`attribute vec3 aPosition;attribute float aSize;uniform mat4 uViewProjection;uniform float uPixelScale;void main(){gl_Position=uViewProjection*vec4(aPosition,1.);gl_PointSize=aSize*uPixelScale;}`,`precision mediump float;uniform float uMode;uniform vec3 uTint;void main(){vec2 p=gl_PointCoord-.5;float r=length(p);if(r>.49)discard;float alpha;if(uMode<.5){float ring=smoothstep(.34,.44,r)*(1.-smoothstep(.44,.49,r));float shine=exp(-length(p-vec2(-.17,.18))*22.);alpha=ring*.28+shine*.44;}else if(uMode>4.5&&uMode<5.5){alpha=(1.-smoothstep(.05,.13,min(abs(p.x),abs(p.y))))*.75;}else if(uMode>5.5&&uMode<6.5){float petal=length(p*vec2(1.,1.8));alpha=(1.-smoothstep(.3,.5,petal))*.7;}else alpha=(1.-smoothstep(.2,.5,r))*.55;gl_FragColor=vec4(uTint,alpha);}`);
  const pointPosition=gl.getAttribLocation(pointProgram,'aPosition'),pointSize=gl.getAttribLocation(pointProgram,'aSize'),pointBuffer=gl.createBuffer();
  const pointVP=gl.getUniformLocation(pointProgram,'uViewProjection'),pointScale=gl.getUniformLocation(pointProgram,'uPixelScale'),pointMode=gl.getUniformLocation(pointProgram,'uMode'),pointTint=gl.getUniformLocation(pointProgram,'uTint');

  function draw(object,matrix=transform()){
    gl.bindBuffer(gl.ARRAY_BUFFER,object.buffer);for(let i=0;i<3;i++){gl.enableVertexAttribArray(attributes[i]);gl.vertexAttribPointer(attributes[i],3,gl.FLOAT,false,36,i*12);}
    gl.uniformMatrix4fv(uniform.uModel,false,matrix);gl.uniform1f(uniform.uKind,object.kind);gl.drawArrays(gl.TRIANGLES,0,object.count);
  }
  function resize(){width=innerWidth;height=innerHeight;dpr=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);gl.viewport(0,0,canvas.width,canvas.height);}
  function render(now){
    const dt=Math.min((now-last)/1000||0,.05);last=now;if(!reduced.matches)elapsed+=dt;
    mx+=(px-mx)*.045;my+=(py-my)*.045;
    const motion=reduced.matches?0:1,t=elapsed*motion,angle=yaw+mx*.09*motion,tilt=elevation+my*.035*motion;
    const distance=35,eye=[Math.sin(angle)*Math.cos(tilt)*distance,4+Math.sin(tilt)*distance,Math.cos(angle)*Math.cos(tilt)*distance];
    const viewHeight=halfH,vp=multiply(ortho(viewHeight*width/height,viewHeight),lookAt(eye,[0,4,0]));
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.useProgram(main);
    gl.uniformMatrix4fv(uniform.uViewProjection,false,vp);gl.uniform3fv(uniform.uEye,eye);gl.uniform3fv(uniform.uFog,rgb(configs[biome].fog));gl.uniform1f(uniform.uBiome,biomeId);gl.uniform2f(uniform.uResolution,canvas.width,canvas.height);gl.uniform1f(uniform.uTime,t);
    draw(seabed);draw(reef);for(const object of objects)draw(object.mesh,object.origin?transform(object.origin[0]+(object.spin>1?Math.sin(t*.3):0),object.origin[1]+Math.sin(t+object.origin[0])*object.bob,object.origin[2],t*object.spin):object.matrix);
    draw(core,transform(0,1.62+Math.sin(t*1.4)*.13,0,t*.22,.86+Math.sin(t*1.4)*.04));
    for(const f of fish){const phase=t*.25+f.phase,x=f.origin[0]+Math.sin(phase)*2.2,z=f.origin[2]+Math.cos(phase)*1.2,y=f.origin[1]+Math.sin(t*.8+f.phase)*.2,direction=Math.atan2(-Math.sin(phase)*1.2,Math.cos(phase)*2.2);draw(f.mesh,transform(x,y,z,-direction,f.size));}
    gl.useProgram(pointProgram);const points=[];for(const b of bubbles)points.push(b.x+Math.sin(t*.35+b.z)*.35,((b.y+t*(biome==='snow'||biome==='cherry'?- .45:.38))%20+20)%20-1,b.z,b.size);
    gl.bindBuffer(gl.ARRAY_BUFFER,pointBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points),gl.DYNAMIC_DRAW);
    for(const a of attributes)gl.disableVertexAttribArray(a);
    gl.enableVertexAttribArray(pointPosition);gl.vertexAttribPointer(pointPosition,3,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(pointSize);gl.vertexAttribPointer(pointSize,1,gl.FLOAT,false,16,12);
    gl.uniformMatrix4fv(pointVP,false,vp);gl.uniform1f(pointScale,dpr);gl.uniform1f(pointMode,biomeId);gl.uniform3fv(pointTint,rgb(configs[biome].particle));gl.depthMask(false);gl.drawArrays(gl.POINTS,0,bubbles.length);gl.depthMask(true);gl.disableVertexAttribArray(pointPosition);gl.disableVertexAttribArray(pointSize);

    canvas.dataset.renderer='webgl';canvas.dataset.scene='voxel-'+biome;canvas.dataset.cameraX=mx.toFixed(3);
    if(!reduced.matches)frame=requestAnimationFrame(render);
  }
  function restart(){cancelAnimationFrame(frame);last=performance.now();frame=requestAnimationFrame(render);}
  addEventListener('pointermove',event=>{if(reduced.matches||event.pointerType==='touch')return;px=event.clientX/width*2-1;py=event.clientY/height*2-1;},{passive:true});
  document.documentElement.addEventListener('pointerleave',()=>{px=py=0;});
  const card=document.querySelector('.auth-card');card?.addEventListener('pointermove',event=>{if(reduced.matches)return;const r=card.getBoundingClientRect(),x=(event.clientX-r.left)/r.width,y=(event.clientY-r.top)/r.height;card.style.setProperty('--card-rotate-x',`${(y-.5)*-2}deg`);card.style.setProperty('--card-rotate-y',`${(x-.5)*2}deg`);},{passive:true});
  card?.addEventListener('pointerleave',()=>{card.style.setProperty('--card-rotate-x','0deg');card.style.setProperty('--card-rotate-y','0deg');});
  addEventListener('resize',()=>{resize();if(reduced.matches)restart();},{passive:true});
  document.addEventListener('visibilitychange',()=>document.hidden?cancelAnimationFrame(frame):restart());reduced.addEventListener('change',restart);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();cancelAnimationFrame(frame);});canvas.addEventListener('webglcontextrestored',()=>location.reload());
  addEventListener('tidal-biome',event=>{buildScene(event.detail);if(reduced.matches)restart();});
  buildScene(document.documentElement.dataset.biome||'ocean');resize();restart();
})();
