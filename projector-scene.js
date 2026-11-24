/* Cached, resolution-independent night panoramas. The city is an artistic
   composition, not a surveyed horizon; sky orientation is handled separately. */
(function(root){
  'use strict';
  const cache = new Map();
  const hash = s => Array.from(s).reduce((a,c)=>Math.imul(a^c.charCodeAt(0),16777619),2166136261)>>>0;
  function random(seed){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
  function rgba(hex,a){const n=parseInt(hex.slice(1),16);return `rgba(${n>>16},${n>>8&255},${n&255},${a})`;}
  function line(c,points,col,width=1){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=col;c.lineWidth=width;c.stroke();}
  function mountain(c,w,base,span,city,r){
    if(city.terrain==='flat') return;
    const alpine=city.terrain==='alps';
    for(let layer=0;layer<2;layer++){
      const pts=[[0,base]];
      for(let x=-w*.08;x<w*1.1;x+=w/(alpine?20:13)){
        const y=base-span*(alpine?.42:.22)-r()*span*(alpine?.54:.3)+layer*span*.12;
        pts.push([x,y]);
      }
      pts.push([w,base]);c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();
      c.fillStyle=layer?'#070d18':'#0b1220';c.fill();
      line(c,pts.slice(1,-1),rgba(city.accent,layer?.10:.17),.8);
      if(alpine&&!layer) for(let i=2;i<pts.length-2;i+=2){
        const [x,y]=pts[i];line(c,[[x-w*.018,y+span*.065],[x,y],[x+w*.013,y+span*.04]],rgba(city.accent,.25),.7);
      }
    }
  }
  function buildings(c,w,base,span,city,r,front,detail){
    const low=['civic','canal','oldtown','roman','victorian'].includes(city.style);
    let x=-8, index=0;
    while(x<w+8){
      const bw=(front?16:24)+r()*(low?30:45), bh=(front?.06:.12)*span+r()*span*(low?.20:.42);
      const y=base-bh, col=front?'#060a11':'#0b1220';
      c.fillStyle=col;c.fillRect(x,y,bw,bh);
      if(low){
        const roof=city.style==='canal'?r():0;
        c.beginPath();c.moveTo(x-1,y);
        if(roof>.5){
          c.lineTo(x+bw*.12,y);c.lineTo(x+bw*.12,y-bh*.12);c.lineTo(x+bw*.3,y-bh*.12);
          c.lineTo(x+bw*.3,y-bh*.25);c.lineTo(x+bw*.44,y-bh*.25);c.lineTo(x+bw*.5,y-bh*.34);
          c.lineTo(x+bw*.56,y-bh*.25);c.lineTo(x+bw*.7,y-bh*.25);c.lineTo(x+bw*.7,y-bh*.12);c.lineTo(x+bw*.88,y-bh*.12);c.lineTo(x+bw*.88,y);
        }else{c.lineTo(x+bw*.5,y-bh*(city.style==='roman'?.06:.24));}
        c.lineTo(x+bw+1,y);c.closePath();c.fill();
        if(detail){c.strokeStyle=rgba(city.accent,.22);c.lineWidth=.7;c.stroke();}
        if(index%3===0){c.fillRect(x+bw*.2,y-bh*.13,3,bh*.18);}
      }else{
        const step=bw*.18;c.fillRect(x+step,y-4,bw-step*2,4);
        if(index%5===0){line(c,[[x+bw*.65,y],[x+bw*.65,y-span*.07]],rgba(city.accent,.28),.7);}
        if(detail) line(c,[[x,y+bh],[x,y],[x+bw,y]],rgba(city.accent,front?.13:.21),.7);
      }
      if(detail){
        const dx=low?8:7, dy=low?11:8;
        for(let wx=x+4;wx<x+bw-3;wx+=dx) for(let wy=y+6;wy<base-4;wy+=dy){
          if(r()>(front?.32:.42))continue;
          c.fillStyle=r()>.22?`rgba(222,185,126,${front?.46:.30})`:rgba(city.accent,.40);
          c.fillRect(wx,wy,low?2.5:1.6,low?3.5:2.1);
        }
        if(!front&&!low){
          c.strokeStyle=rgba(city.accent,.07);c.lineWidth=.5;
          for(let yy=y+10;yy<base;yy+=9){c.beginPath();c.moveTo(x,yy);c.lineTo(x+bw,yy);c.stroke();}
        }
      }
      x+=bw+(low?2:3+r()*7);index++;
    }
  }
  function trees(c,w,base,span,city,r){
    c.strokeStyle='#050a10';c.fillStyle='#050a10';
    if(city.id==='la'){
      for(const pos of [.035,.09,.84,.94]){
        const x=pos*w, tall=span*(.26+r()*.17), top=base-tall;
        c.lineWidth=Math.max(2,w*.0013);c.beginPath();c.moveTo(x-3,base);c.quadraticCurveTo(x+5,top+tall*.5,x,top);c.stroke();
        for(let i=0;i<7;i++){const a=i*Math.PI/3.5;c.beginPath();c.moveTo(x,top);c.quadraticCurveTo(x+Math.cos(a)*tall*.19,top+Math.sin(a)*tall*.12-3,x+Math.cos(a)*tall*.27,top+Math.sin(a)*tall*.2+7);c.lineWidth=2;c.stroke();}
      }
      return;
    }
    for(let i=0;i<(city.style==='civic'?32:13);i++){
      const x=r()*w,h=span*(.025+r()*.045);c.fillRect(x,base-h*.4,1.5,h*.4);
      c.beginPath();c.ellipse(x,base-h*.65,h*.45,h*.6,0,0,Math.PI*2);c.fill();
    }
  }
  function waterfront(c,w,h,base,span,city,r,detail){
    if(city.water){
      const depth=Math.min(h-base,span*.25), g=c.createLinearGradient(0,base,0,base+depth);
      g.addColorStop(0,'#07111b');g.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=g;c.fillRect(0,base,w,depth);
      if(detail){
        for(let i=0;i<Math.floor(w/5);i++){
          const x=r()*w,y=base+3+Math.pow(r(),1.7)*depth, length=1+r()*10;
          c.fillStyle=i%5?rgba(city.accent,.07+r()*.10):'rgba(222,182,126,.19)';c.fillRect(x,y,length,.6+r()*.6);
        }
        c.strokeStyle=rgba(city.accent,.24);c.lineWidth=.6;c.beginPath();c.moveTo(0,base);c.lineTo(w,base);c.stroke();
      }
    }
    if(!detail)return;
    // A thin riverside or street edge; enough light to describe the ground.
    const edge=base+Math.min(span*.19,(h-base)*.36);
    line(c,[[0,edge],[w,edge]],rgba(city.accent,.12),.7);
    for(let x=12;x<w;x+=w/36){
      const y=city.water?base+1:base-2;
      c.fillStyle='rgba(220,189,143,.43)';c.fillRect(x,y,1.6,1.2);
      if(city.water){c.fillStyle='rgba(220,189,143,.08)';c.fillRect(x-.5,y+3,2.5,3+r()*7);}
    }
    if(city.id==='amsterdam'){
      for(let i=0;i<12;i++){
        const x=(.07+i*.077)*w,y=edge-3;
        c.strokeStyle=rgba(city.accent,.31);c.lineWidth=.65;
        c.beginPath();c.arc(x,y,2,0,Math.PI*2);c.moveTo(x+8,y);c.arc(x+6,y,2,0,Math.PI*2);c.stroke();
        line(c,[[x,y],[x+2,y-4],[x+5,y],[x,y],[x+5,y-3]],rgba(city.accent,.28),.6);
      }
    }
  }
  function bake(o){
    const {city,width:w,height:h,baseline:base,detail,labels}=o;
    const dpr=Math.min(2,root.devicePixelRatio||1), canvas=document.createElement('canvas');
    canvas.width=Math.ceil(w*dpr);canvas.height=Math.ceil(h*dpr);
    const c=canvas.getContext('2d');c.scale(dpr,dpr);
    const r=random(hash(city.id)),span=Math.min(h*.40,w*.24);
    const glow=c.createRadialGradient(w*.50,base,0,w*.50,base,w*.58);
    glow.addColorStop(0,rgba(city.accent,.065));glow.addColorStop(1,rgba(city.accent,0));
    c.fillStyle=glow;c.fillRect(0,base-span*1.5,w,span*1.5);
    mountain(c,w,base,span,city,r);
    buildings(c,w,base,span,city,r,false,detail);
    const p={body:'#0a101c',edge:rgba(city.accent,detail?.56:.35),accent:rgba(city.accent,.75),window:'rgba(224,190,134,.62)',dim:rgba(city.accent,.23)};
    const landmarks=(root.TBProjectorLandmarks||{})[city.id]||[];
    landmarks.forEach(mark=>{
      c.save();c.translate(mark.x*w,base);c.scale(mark.width*w/100,mark.height*span/100);
      c.fillStyle=p.body;c.strokeStyle=p.edge;c.lineWidth=.65;c.lineJoin='round';c.lineCap='round';
      mark.draw(c,detail?p:{...p,window:'transparent',dim:'transparent'});c.restore();
    });
    buildings(c,w,base,span*.27,city,r,true,detail);
    trees(c,w,base,span,city,r);
    waterfront(c,w,h,base,span,city,r,detail);
    if(labels&&w>=640){
      c.font=`500 ${Math.max(9,Math.min(13,w*.0065))}px system-ui`;c.textAlign='center';c.fillStyle=rgba(city.accent,.65);
      let right=-Infinity;
      landmarks.forEach(mark=>{
        const x=(mark.x+mark.width*.5)*w,text=mark.name,tw=c.measureText(text).width;
        if(x-tw*.5<right+16||x+tw*.5>w-10)return;
        c.fillText(text,x,base+span*.10);right=x+tw*.5;
      });
    }
    return canvas;
  }
  function draw(c,options){
    const o={detail:true,labels:false,...options}, key=[o.city.id,o.width,o.height,o.baseline,o.detail,o.labels,Math.min(2,root.devicePixelRatio||1)].join('|');
    let layer=cache.get(key);
    if(!layer){layer=bake(o);cache.set(key,layer);if(cache.size>16)cache.delete(cache.keys().next().value);}
    c.drawImage(layer,0,0,o.width,o.height);
    if(o.motion&&o.city.water){
      const t=(o.now||Date.now())/1700,depth=Math.min(o.height-o.baseline,o.height*.075);
      c.save();c.strokeStyle=rgba(o.city.accent,.12);c.lineWidth=.65;
      for(let i=0;i<18;i++){
        const x=(i*.061+.017*Math.sin(t+i))*o.width,y=o.baseline+8+(i%5)/5*depth;
        c.beginPath();c.moveTo(x,y);c.lineTo(x+4+6*Math.sin(t+i)*Math.sin(t+i),y);c.stroke();
      }
      c.restore();
    }
  }
  root.TBProjectorScene={draw,clear:()=>cache.clear()};
})(window);
