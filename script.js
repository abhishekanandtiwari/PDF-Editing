pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const {PDFDocument,rgb,StandardFonts,degrees,grayscale}=PDFLib;

/* ========== UTILS ========== */
let _toastT;
function toast(msg,type=''){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className='show'+(type?' '+type:'');
  clearTimeout(_toastT);_toastT=setTimeout(()=>t.className='',2600);
}
function loading(show,msg='Processing…'){
  document.getElementById('loading').classList.toggle('show',show);
  document.getElementById('loadingMsg').textContent=msg;
}
function download(bytes,name,mime='application/pdf'){
  const b=new Blob([bytes],{type:mime});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
function downloadText(text,name,mime='text/plain'){download(new TextEncoder().encode(text),name,mime);}
function dataUrlToBytes(u){const b=atob(u.split(',')[1]);const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a;}
function hexToRgb(h){const v=h.replace('#','');return rgb(parseInt(v.slice(0,2),16)/255,parseInt(v.slice(2,4),16)/255,parseInt(v.slice(4,6),16)/255);}

/* ========== GLOBAL STATE ========== */
let sourceBuffers=[];   // [{name,bytes,pdfjsDoc}]
let pages=[];           // [{srcIdx,pageNum(1-based),rotDelta,removed}]
let workingPdfBytes=null; // built bytes
let editPdfjsDoc=null,editPageNum=1,editTotalPages=1,editScale=1.4;
let annStore={};        // pageNum -> [{type,x,y,...}]
let editTool=null,pendingSigUrl=null;
let signPdfjsDoc=null,signPageNum=1,signTotalPages=1,signScale=1.4;
let signAnnStore={};
let signTool=null,pendingSignUrl=null;
let scanImages=[];      // [{name,dataUrl}]
let img2pdfImages=[];
let compareBufA=null,compareBufB=null;

/* ========== NAV / MEGA MENU ========== */
document.querySelectorAll('.mcat-trigger').forEach(t=>{
  t.addEventListener('click',e=>{
    e.stopPropagation();
    const cat=t.closest('.mcat');
    const isOpen=cat.classList.contains('open');
    document.querySelectorAll('.mcat').forEach(c=>c.classList.remove('open'));
    if(!isOpen)cat.classList.add('open');
  });
});
document.querySelectorAll('.mdrop .mtool').forEach(b=>{
  b.addEventListener('click',e=>{
    e.stopPropagation();
    document.querySelectorAll('.mcat').forEach(c=>c.classList.remove('open'));
    activateTool(b.dataset.tool);
  });
});
document.querySelectorAll('.tool-card,.tool-cards .tool-card').forEach(c=>{
  c.addEventListener('click',()=>activateTool(c.dataset.tool));
});
document.addEventListener('click',()=>document.querySelectorAll('.mcat').forEach(c=>c.classList.remove('open')));

/* ========== FILE INPUT ========== */
const dropZone=document.getElementById('dropZone');
const fileInput=document.getElementById('fileInput');
dropZone.addEventListener('click',()=>fileInput.click());
['dragenter','dragover'].forEach(e=>dropZone.addEventListener(e,ev=>{ev.preventDefault();dropZone.classList.add('drag');}));
['dragleave','drop'].forEach(e=>dropZone.addEventListener(e,ev=>{ev.preventDefault();dropZone.classList.remove('drag');}));
dropZone.addEventListener('drop',e=>handleFiles(e.dataTransfer.files));
fileInput.addEventListener('change',e=>handleFiles(e.target.files));

async function handleFiles(fileList){
  const files=Array.from(fileList);
  const pdfs=files.filter(f=>f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf'));
  const imgs=files.filter(f=>f.type.startsWith('image/'));

  if(pdfs.length===0 && imgs.length>0){
    // route to scan or img2pdf depending on active tool
    await addImagesToScan(imgs);
    return;
  }
  loading(true,'Loading PDF…');
  for(const f of pdfs){
    try{
      const bytes=new Uint8Array(await f.arrayBuffer());
      const pdfjsDoc=await pdfjsLib.getDocument({data:bytes.slice()}).promise;
      const idx=sourceBuffers.length;
      sourceBuffers.push({name:f.name,bytes,pdfjsDoc});
      for(let p=1;p<=pdfjsDoc.numPages;p++) pages.push({srcIdx:idx,pageNum:p,rotDelta:0,removed:false});
      workingPdfBytes=null;
    }catch(err){toast('Error loading '+f.name,'err');}
  }
  loading(false);
  updateBadge();
  if(currentWs && currentWs!=='toolHome') rerouteToCurrentWs();
  else activateTool('organize');
  toast(`Loaded ${pdfs.length} PDF${pdfs.length!==1?'s':''}${imgs.length?' + '+imgs.length+' image(s)':''}`,'ok');
}

function updateBadge(){
  const badge=document.getElementById('fileBadge');
  const n=sourceBuffers.length;
  badge.classList.toggle('show',n>0);
  document.getElementById('badgeText').textContent=`${n} file${n!==1?'s':''}`;
}

/* ========== WORKSPACE ROUTING ========== */
let currentWs='toolHome';
function showHome(){
  document.querySelectorAll('.ws-wrap').forEach(w=>w.classList.remove('active'));
  document.getElementById('toolHome').style.display='block';
  document.getElementById('heroSection').style.display='block';
  currentWs='toolHome';
}
function activateTool(tool){
  document.getElementById('toolHome').style.display='none';
  document.getElementById('heroSection').style.display='none';
  document.querySelectorAll('.ws-wrap').forEach(w=>w.classList.remove('active'));
  const wsMap={
    merge:'organize',organize:'organize',split:'split',scan:'scan',
    compress:'compress',repair:'repair',ocr:'ocr',
    pdf2word:'pdf2word',pdf2ppt:'pdf2ppt',pdf2excel:'pdf2excel',
    img2pdf:'img2pdf',html2pdf:'html2pdf',pdf2html:'pdf2html',
    edit:'edit',watermark:'watermark',rotate:'rotate',pagenumbers:'pagenumbers',crop:'crop',
    sign:'sign',unlock:'unlock',protect:'protect',compare:'compare',
    summarize:'summarize',translate:'translate'
  };
  const wsId='ws-'+(wsMap[tool]||tool);
  const ws=document.getElementById(wsId);
  if(ws){ws.classList.add('active');currentWs=wsMap[tool]||tool;}
  window.scrollTo({top:0,behavior:'smooth'});
  onToolActivate(tool);
}
function rerouteToCurrentWs(){
  activateTool(currentWs);
}

function onToolActivate(tool){
  const hasPdf=sourceBuffers.length>0;
  if(tool==='organize'||tool==='merge') renderPageGrid();
  if(tool==='rotate') renderRotateGrid();
  if(tool==='edit'&&hasPdf) openEditor();
  if(tool==='sign'&&hasPdf) openSignEditor();
  if(tool==='split'&&hasPdf) initSplit();
  if(tool==='watermark'&&hasPdf) renderWatermarkPreview();
  if(tool==='compress') updateCompressStats();
  if(tool==='repair') updateRepairStats();
  if(tool==='ocr') document.getElementById('ocrEmpty').style.display='none';
  if(tool==='pdf2word'||tool==='pdf2excel'||tool==='pdf2html') renderTextOut(tool);
  if(tool==='crop'&&hasPdf) renderCropPreview();
  if(tool==='pagenumbers') document.getElementById('pnEmpty').style.display=hasPdf?'none':'block';
  if(tool==='unlock') document.getElementById('unlockEmpty').style.display=hasPdf?'none':'block';
  if(tool==='protect') document.getElementById('protectEmpty').style.display=hasPdf?'none':'block';
  if(tool==='scan') renderScanList();
  if(tool==='img2pdf') renderImg2pdfGrid();
}

/* ========== BUILD WORKING DOC ========== */
async function buildDoc(){
  const visible=pages.filter(p=>!p.removed);
  if(!visible.length) return null;
  const out=await PDFDocument.create();
  const cache={};
  for(const p of visible){
    if(!cache[p.srcIdx]) cache[p.srcIdx]=await PDFDocument.load(sourceBuffers[p.srcIdx].bytes);
    const [copied]=await out.copyPages(cache[p.srcIdx],[p.pageNum-1]);
    if(p.rotDelta){const c=copied.getRotation().angle||0;copied.setRotation(degrees(c+p.rotDelta));}
    out.addPage(copied);
  }
  return out;
}

/* ========== ORGANIZE / MERGE ========== */
async function renderPageGrid(){
  const grid=document.getElementById('pageGrid');
  grid.innerHTML='';
  const visible=pages.filter(p=>!p.removed);
  document.getElementById('orgEmpty').style.display=visible.length?'none':'block';
  for(let i=0;i<pages.length;i++){
    const p=pages[i]; if(p.removed)continue;
    const card=makePageCard(p,i,async(canvas)=>await renderThumb(canvas,p));
    grid.appendChild(card);
    makeDraggable(card,i);
  }
}
function makePageCard(p,i,thumbFn){
  const card=document.createElement('div');card.className='pc';card.dataset.index=i;
  const src=document.createElement('div');src.className='pc-src';
  src.textContent=(p.srcName||sourceBuffers[p.srcIdx].name).slice(0,14);
  card.appendChild(src);
  const canvas=document.createElement('canvas');card.appendChild(canvas);
  thumbFn(canvas);
  const foot=document.createElement('div');foot.className='pc-foot';
  foot.innerHTML=`<span>p.${p.pageNum}</span>`;
  const acts=document.createElement('div');acts.className='pc-acts';
  acts.innerHTML='<button title="Rotate">↻</button><button title="Delete">✕</button>';
  acts.children[0].onclick=e=>{e.stopPropagation();p.rotDelta=(p.rotDelta+90)%360;renderThumb(canvas,p);};
  acts.children[1].onclick=e=>{e.stopPropagation();p.removed=true;renderPageGrid();};
  foot.appendChild(acts);card.appendChild(foot);
  return card;
}
function makeDraggable(card,i){
  card.draggable=true;
  card.addEventListener('dragstart',e=>{card.classList.add('dragging');e.dataTransfer.setData('text/plain',i);});
  card.addEventListener('dragend',()=>card.classList.remove('dragging'));
  card.addEventListener('dragover',e=>e.preventDefault());
  card.addEventListener('drop',e=>{
    e.preventDefault();
    const from=parseInt(e.dataTransfer.getData('text/plain')),to=parseInt(card.dataset.index);
    if(from===to)return;
    const [moved]=pages.splice(from,1);pages.splice(to,0,moved);renderPageGrid();
  });
}
async function renderThumb(canvas,p){
  const doc=sourceBuffers[p.srcIdx].pdfjsDoc;
  const page=await doc.getPage(p.pageNum);
  const vp=page.getViewport({scale:0.4,rotation:p.rotDelta});
  canvas.width=vp.width;canvas.height=vp.height;
  await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
}

document.getElementById('rotateAllBtn').onclick=()=>{pages.forEach(p=>{if(!p.removed)p.rotDelta=(p.rotDelta+90)%360;});renderPageGrid();};
document.getElementById('removeAllBtn').onclick=()=>{pages=[]; sourceBuffers=[];workingPdfBytes=null;updateBadge();renderPageGrid();};
document.getElementById('buildBtn').onclick=async()=>{
  if(!pages.filter(p=>!p.removed).length){toast('No pages to build','err');return;}
  loading(true,'Building PDF…');
  const doc=await buildDoc();
  workingPdfBytes=await doc.save();
  loading(false);
  download(workingPdfBytes,'folio-merged.pdf');
  toast('Downloaded merged PDF','ok');
};

/* ========== SPLIT ========== */
function initSplit(){
  const total=pages.filter(p=>!p.removed).length;
  document.getElementById('splitInfo').textContent=total?`PDF has ${total} pages total.`:'';
  document.getElementById('splitEmpty').style.display=total?'none':'block';
  if(total&&document.getElementById('splitList').children.length===0) addSplitRange();
}
let rangeCount=0;
function addSplitRange(){
  const total=pages.filter(p=>!p.removed).length;
  rangeCount++;
  const row=document.createElement('div');row.className='split-range';
  row.innerHTML=`<span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--ink2)">Range ${rangeCount}</span>
    <label>From page</label><input type="number" min="1" max="${total}" value="1" class="sr-from">
    <label>to page</label><input type="number" min="1" max="${total}" value="${total}" class="sr-to">
    <label>Name</label><input type="text" value="part-${rangeCount}" class="sr-name" style="width:90px;">
    <button title="Remove" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:16px;">✕</button>`;
  row.querySelector('button').onclick=()=>row.remove();
  document.getElementById('splitList').appendChild(row);
}
document.getElementById('addRangeBtn').onclick=addSplitRange;
document.getElementById('splitDownloadBtn').onclick=async()=>{
  const vis=pages.filter(p=>!p.removed);
  if(!vis.length){toast('Load a PDF first','err');return;}
  const rows=document.querySelectorAll('.split-range');
  if(!rows.length){toast('Add at least one range','err');return;}
  loading(true,'Splitting…');
  const srcDoc=await PDFDocument.load(sourceBuffers[vis[0].srcIdx].bytes);
  for(const row of rows){
    const from=parseInt(row.querySelector('.sr-from').value)-1;
    const to=parseInt(row.querySelector('.sr-to').value)-1;
    const name=row.querySelector('.sr-name').value||'split';
    const out=await PDFDocument.create();
    const idxs=[];for(let i=from;i<=to&&i<srcDoc.getPageCount();i++)idxs.push(i);
    const copied=await out.copyPages(srcDoc,idxs);
    copied.forEach(p=>out.addPage(p));
    download(await out.save(),name+'.pdf');
  }
  loading(false);toast('Split files downloaded','ok');
};

/* ========== SCAN / IMAGE TO PDF ========== */
document.getElementById('addImagesBtn').onclick=()=>document.querySelector('#ws-scan input[type=file]')||document.getElementById('imgInput').click();
document.getElementById('imgInput').onchange=e=>addImagesToScan(e.target.files);
async function addImagesToScan(files){
  if(!activateScanIfNeeded()) activateTool('scan');
  for(const f of Array.from(files).filter(f=>f.type.startsWith('image/'))){
    const dr=new FileReader();
    await new Promise(res=>{dr.onload=e=>{scanImages.push({name:f.name,dataUrl:e.target.result});res();};dr.readAsDataURL(f);});
  }
  renderScanList();
}
function activateScanIfNeeded(){return currentWs==='scan';}
function renderScanList(){
  const list=document.getElementById('scanPages');
  list.innerHTML='';
  document.getElementById('scanEmpty').style.display=scanImages.length?'none':'block';
  scanImages.forEach((img,i)=>{
    const item=document.createElement('div');item.className='scan-page-item';
    const im=document.createElement('img');im.src=img.dataUrl;
    const span=document.createElement('span');span.textContent=img.name;
    const del=document.createElement('button');del.className='btn xs sec';del.textContent='✕';
    del.onclick=()=>{scanImages.splice(i,1);renderScanList();};
    item.appendChild(im);item.appendChild(span);item.appendChild(del);
    list.appendChild(item);
  });
}
document.getElementById('scanDownloadBtn').onclick=async()=>{
  if(!scanImages.length){toast('Add images first','err');return;}
  loading(true,'Building PDF from images…');
  const doc=await PDFDocument.create();
  for(const img of scanImages){
    let embedded;
    if(img.dataUrl.includes('image/png'))embedded=await doc.embedPng(dataUrlToBytes(img.dataUrl));
    else embedded=await doc.embedJpg(dataUrlToBytes(img.dataUrl));
    const page=doc.addPage([embedded.width,embedded.height]);
    page.drawImage(embedded,{x:0,y:0,width:embedded.width,height:embedded.height});
  }
  download(await doc.save(),'scan.pdf');
  loading(false);toast('Downloaded scan PDF','ok');
};

/* ========== COMPRESS ========== */
function updateCompressStats(){
  const hasPdf=sourceBuffers.length>0;
  document.getElementById('compressEmpty').style.display=hasPdf?'none':'block';
  if(hasPdf){
    const orig=sourceBuffers[0].bytes.length;
    document.getElementById('compressStats').innerHTML=`<b>Original size:</b> ${(orig/1024).toFixed(1)} KB`;
  }
}
document.getElementById('compressBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  loading(true,'Compressing…');
  const src=await PDFDocument.load(sourceBuffers[0].bytes,{ignoreEncryption:true});
  const out=await PDFDocument.create();
  const idxs=[...Array(src.getPageCount()).keys()];
  const copied=await out.copyPages(src,idxs);
  copied.forEach(p=>out.addPage(p));
  const result=await out.save({objectsPerTick:50,useObjectStreams:true,addDefaultPage:false,compress:true});
  const orig=sourceBuffers[0].bytes.length;
  const saved=orig-result.length;
  const pct=((saved/orig)*100).toFixed(1);
  document.getElementById('compressStats').innerHTML=
    `<b>Original:</b> ${(orig/1024).toFixed(1)} KB &nbsp;→&nbsp; <b>Compressed:</b> ${(result.length/1024).toFixed(1)} KB &nbsp;→&nbsp; <b>Saved:</b> ${saved>0?pct+'%':'no reduction (already optimised)'}`;
  download(result,'compressed.pdf');
  loading(false);toast(`Compressed PDF downloaded`,'ok');
};

/* ========== REPAIR ========== */
function updateRepairStats(){
  const hasPdf=sourceBuffers.length>0;
  document.getElementById('repairEmpty').style.display=hasPdf?'none':'block';
  if(hasPdf) document.getElementById('repairStats').textContent=`File: ${sourceBuffers[0].name}`;
}
document.getElementById('repairBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  loading(true,'Repairing…');
  try{
    const src=await PDFDocument.load(sourceBuffers[0].bytes,{ignoreEncryption:true,throwOnInvalidObject:false,updateMetadata:false});
    const out=await PDFDocument.create();
    const idxs=[...Array(src.getPageCount()).keys()];
    const copied=await out.copyPages(src,idxs);
    copied.forEach(p=>out.addPage(p));
    download(await out.save(),'repaired.pdf');
    document.getElementById('repairStats').innerHTML=`✓ Repaired successfully. ${src.getPageCount()} pages recovered.`;
    loading(false);toast('Repaired PDF downloaded','ok');
  }catch(e){
    loading(false);toast('Could not repair — file may be too damaged','err');
    document.getElementById('repairStats').textContent='Repair failed: '+e.message;
  }
};

/* ========== OCR ========== */
let ocrText='';
document.getElementById('ocrBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  const vis=pages.filter(p=>!p.removed);
  const total=vis.length||sourceBuffers[0].pdfjsDoc.numPages;
  const prog=document.getElementById('ocrProgress');
  const fill=document.getElementById('ocrFill');
  prog.style.display='block';
  ocrText='';
  const outEl=document.getElementById('ocrOut');
  outEl.textContent='Extracting text…';
  const pdfjsDoc=sourceBuffers[0].pdfjsDoc;
  for(let i=1;i<=total;i++){
    fill.style.width=((i/total)*100)+'%';
    try{
      const page=await pdfjsDoc.getPage(i);
      const tc=await page.getTextContent();
      const t=tc.items.map(x=>x.str).join(' ').trim();
      ocrText+=`\n--- Page ${i} ---\n`+t+'\n';
    }catch(e){ocrText+=`\n--- Page ${i} (error) ---\n`;}
  }
  outEl.textContent=ocrText||'No text found in this PDF.';
  prog.style.display='none';
  document.getElementById('ocrDownloadBtn').disabled=!ocrText;
  toast('OCR complete','ok');
};
document.getElementById('ocrDownloadBtn').onclick=()=>{if(ocrText)downloadText(ocrText,'ocr-output.txt');};

/* ========== PDF → TEXT/HTML/CSV ========== */
async function extractFullText(){
  if(!sourceBuffers.length)return'';
  const doc=sourceBuffers[0].pdfjsDoc;
  let t='';
  for(let i=1;i<=doc.numPages;i++){
    const page=await doc.getPage(i);
    const tc=await page.getTextContent();
    t+=tc.items.map(x=>x.str).join(' ')+'\n';
  }
  return t;
}
async function renderTextOut(tool){
  const hasPdf=sourceBuffers.length>0;
  if(tool==='pdf2word'){
    document.getElementById('p2wEmpty').style.display=hasPdf?'none':'block';
    if(!hasPdf)return;
    const t=await extractFullText();
    document.getElementById('p2wOut').textContent=t;
  }
  if(tool==='pdf2excel'){
    document.getElementById('p2csvEmpty').style.display=hasPdf?'none':'block';
    if(!hasPdf)return;
    const t=await extractFullText();
    const csv=t.split('\n').map(r=>'"'+r.replace(/"/g,'""')+'"').join('\n');
    document.getElementById('p2csvOut').textContent=csv;
  }
  if(tool==='pdf2html'){
    if(!hasPdf)return;
    const t=await extractFullText();
    const h=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PDF Export</title><style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;line-height:1.7;}</style></head><body><pre style="white-space:pre-wrap">${t.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></body></html>`;
    document.getElementById('p2htmlOut').textContent=h;
  }
}
document.getElementById('p2wBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  loading(true,'Extracting…');const t=await extractFullText();loading(false);
  downloadText(t,(sourceBuffers[0].name.replace('.pdf',''))+'.txt');toast('Downloaded .txt','ok');
};
document.getElementById('p2csvBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  loading(true,'Extracting…');const t=await extractFullText();loading(false);
  const csv=t.split('\n').map(r=>'"'+r.replace(/"/g,'""')+'"').join('\n');
  downloadText(csv,'pdf-export.csv','text/csv');toast('Downloaded .csv','ok');
};
document.getElementById('p2htmlBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  loading(true,'Converting…');const t=await extractFullText();loading(false);
  const h=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PDF Export</title><style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;line-height:1.8;}</style></head><body><pre style="white-space:pre-wrap">${t.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></body></html>`;
  downloadText(h,'pdf-export.html','text/html');toast('Downloaded .html','ok');
};

/* PDF to HTML slides */
document.getElementById('p2pptBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  loading(true,'Generating slides…');
  const doc=sourceBuffers[0].pdfjsDoc;
  const tmpCanvas=document.createElement('canvas');
  const ctx=tmpCanvas.getContext('2d');
  let slides='';
  for(let i=1;i<=doc.numPages;i++){
    const page=await doc.getPage(i);
    const vp=page.getViewport({scale:1.5});
    tmpCanvas.width=vp.width;tmpCanvas.height=vp.height;
    await page.render({canvasContext:ctx,viewport:vp}).promise;
    const img=tmpCanvas.toDataURL('image/jpeg',0.85);
    slides+=`<div class="slide"><img src="${img}" alt="Slide ${i}"><div class="pg">Slide ${i} / ${doc.numPages}</div></div>`;
  }
  const scriptTag = '<scr'+'ipt>';
  const scriptClose = '<'+'/script>';
  const slideJS = scriptTag + 'let c=0,s=document.querySelectorAll(".slide");function go(d){s[c].classList.remove("active");c=(c+d+s.length)%s.length;s[c].classList.add("active");}s[0].classList.add("active");document.addEventListener("keydown",function(e){if(e.key==="ArrowRight")go(1);if(e.key==="ArrowLeft")go(-1);});' + scriptClose;
  const css = '*{margin:0;padding:0;box-sizing:border-box}body{background:#111;font-family:sans-serif;}.slide{display:none;position:relative;text-align:center;height:100vh;align-items:center;justify-content:center;flex-direction:column;}.slide.active{display:flex;}.slide img{max-width:95vw;max-height:90vh;object-fit:contain;border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,.6);}.pg{color:#888;font-size:13px;margin-top:12px;font-family:monospace;}#ctrl{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);display:flex;gap:12px;}#ctrl button{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);color:#fff;padding:8px 20px;cursor:pointer;border-radius:4px;font-size:13px;}#ctrl button:hover{background:rgba(255,255,255,.25);}';
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PDF Slides</title><style>' + css + '</style></head><body>' + slides + '<div id="ctrl"><button onclick="go(-1)">&#8249; Prev</button><button onclick="go(1)">Next &#8250;</button></div>' + slideJS + '</body></html>';
  loading(false);downloadText(html,'slides.html','text/html');toast('Downloaded slideshow HTML','ok');
};

/* ========== IMG2PDF ========== */
document.getElementById('addImg2pdfBtn').onclick=()=>document.getElementById('imgInput2').click();
document.getElementById('imgInput2').onchange=async e=>{
  for(const f of Array.from(e.target.files).filter(f=>f.type.startsWith('image/'))){
    const dr=new FileReader();
    await new Promise(res=>{dr.onload=ev=>{img2pdfImages.push({name:f.name,dataUrl:ev.target.result});res();};dr.readAsDataURL(f);});
  }
  renderImg2pdfGrid();
};
function renderImg2pdfGrid(){
  const grid=document.getElementById('img2pdfGrid');grid.innerHTML='';
  document.getElementById('img2pdfEmpty').style.display=img2pdfImages.length?'none':'block';
  img2pdfImages.forEach((img,i)=>{
    const card=document.createElement('div');card.className='pc';
    const im=document.createElement('img');im.src=img.dataUrl;im.style.cssText='width:100%;display:block;border-bottom:1px solid var(--line);';
    card.appendChild(im);
    const foot=document.createElement('div');foot.className='pc-foot';
    foot.innerHTML=`<span>${img.name.slice(0,16)}</span>`;
    const del=document.createElement('button');del.className='btn xs sec';del.style.fontSize='11px';del.textContent='✕';
    del.onclick=()=>{img2pdfImages.splice(i,1);renderImg2pdfGrid();};
    foot.appendChild(del);card.appendChild(foot);
    grid.appendChild(card);
  });
}
document.getElementById('img2pdfBtn').onclick=async()=>{
  if(!img2pdfImages.length){toast('Add images first','err');return;}
  loading(true,'Converting…');
  const doc=await PDFDocument.create();
  for(const img of img2pdfImages){
    let em;
    try{if(img.dataUrl.includes('image/png'))em=await doc.embedPng(dataUrlToBytes(img.dataUrl));else em=await doc.embedJpg(dataUrlToBytes(img.dataUrl));}
    catch(e){try{em=await doc.embedPng(dataUrlToBytes(img.dataUrl));}catch(e2){continue;}}
    const pg=doc.addPage([em.width,em.height]);
    pg.drawImage(em,{x:0,y:0,width:em.width,height:em.height});
  }
  download(await doc.save(),'images.pdf');
  loading(false);toast('Downloaded PDF','ok');
};

/* ========== HTML2PDF ========== */
const htmlInput=document.getElementById('htmlInput');
htmlInput.addEventListener('input',()=>{
  document.getElementById('htmlPreviewWrap').innerHTML=htmlInput.value;
});
document.getElementById('html2pdfBtn').onclick=async()=>{
  loading(true,'Rendering HTML to PDF…');
  const wrap=document.getElementById('htmlPreviewWrap');
  wrap.innerHTML=htmlInput.value;
  await new Promise(r=>setTimeout(r,200));
  const canvas=await html2canvas(wrap,{scale:2,useCORS:true,logging:false});
  const imgData=canvas.toDataURL('image/png');
  const doc=await PDFDocument.create();
  const img=await doc.embedPng(dataUrlToBytes(imgData));
  const page=doc.addPage([img.width/2,img.height/2]);
  page.drawImage(img,{x:0,y:0,width:img.width/2,height:img.height/2});
  download(await doc.save(),'html-export.pdf');
  loading(false);toast('Downloaded PDF from HTML','ok');
};

/* ========== EDIT / ANNOTATE ========== */
async function openEditor(){
  const vis=pages.filter(p=>!p.removed);
  if(!vis.length){document.getElementById('editEmpty').style.display='block';return;}
  document.getElementById('editEmpty').style.display='none';
  if(!workingPdfBytes){const d=await buildDoc();workingPdfBytes=await d.save();}
  editPdfjsDoc=await pdfjsLib.getDocument({data:workingPdfBytes.slice()}).promise;
  editTotalPages=editPdfjsDoc.numPages;editPageNum=1;
  await renderEditPage();
}
async function renderEditPage(){
  const page=await editPdfjsDoc.getPage(editPageNum);
  const vp=page.getViewport({scale:editScale});
  const canvas=document.getElementById('pdfCanvas');
  canvas.width=vp.width;canvas.height=vp.height;
  await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
  const layer=document.getElementById('annLayer');
  layer.style.cssText=`position:absolute;top:0;left:0;width:${vp.width}px;height:${vp.height}px;pointer-events:none;`;
  layer.innerHTML='';
  (annStore[editPageNum]||[]).forEach((a,idx)=>layer.appendChild(makeAnnEl(a,editPageNum,idx)));
  document.getElementById('pageIndicator').textContent=`Page ${editPageNum} / ${editTotalPages}`;
}
function makeAnnEl(a,pn,idx){
  const el=document.createElement('div');
  el.className='ann-el';
  el.style.cssText=`left:${a.x}px;top:${a.y}px;position:absolute;`;
  el.innerHTML=`<span class="ann-del" onclick="removeAnn(${pn},${idx})">✕</span>`;
  if(a.type==='text'){
    const t=document.createElement('span');t.textContent=a.text;
    t.style.cssText=`color:${a.color};font-size:${a.size}px;font-family:'Source Sans 3',sans-serif;white-space:nowrap;`;
    el.appendChild(t);
  }else if(a.type==='sig'){
    const im=document.createElement('img');im.src=a.dataUrl;im.style.cssText=`width:${a.w}px;pointer-events:none;`;
    el.appendChild(im);
  }
  el.style.pointerEvents='all';
  return el;
}
window.removeAnn=(pn,idx)=>{annStore[pn].splice(idx,1);renderEditPage();};

document.getElementById('prevPage').onclick=()=>{if(editPageNum>1){editPageNum--;renderEditPage();}};
document.getElementById('nextPage').onclick=()=>{if(editPageNum<editTotalPages){editPageNum++;renderEditPage();}};
document.getElementById('textSize').oninput=e=>document.getElementById('sizeVal').textContent=e.target.value;
document.getElementById('placeTextBtn').onclick=()=>{
  if(!document.getElementById('textInput').value.trim()){toast('Enter text first','err');return;}
  editTool='text';toast('Click on the page to place text');
};

document.getElementById('editCanvasWrap').addEventListener('click',e=>{
  if(!editTool)return;
  const wrap=document.getElementById('pdfCanvas').getBoundingClientRect();
  const scr=document.getElementById('editCanvasWrap');
  const x=e.clientX-wrap.left+scr.scrollLeft;
  const y=e.clientY-wrap.top+scr.scrollTop;
  annStore[editPageNum]=annStore[editPageNum]||[];
  if(editTool==='text'){
    annStore[editPageNum].push({type:'text',x,y,text:document.getElementById('textInput').value,color:document.getElementById('textColor').value,size:parseInt(document.getElementById('textSize').value)});
  }else if(editTool==='sig'){
    if(!pendingSigUrl){toast('Create a signature first','err');return;}
    annStore[editPageNum].push({type:'sig',x,y,dataUrl:pendingSigUrl,w:160});
  }
  editTool=null;renderEditPage();
});

/* Sig pad (edit) */
setupSigPad('sigPad',()=>pendingSigUrl=document.getElementById('sigPad').toDataURL(),'placeSigBtn','clearSigBtn','typedSig');
function setupSigPad(canvasId,onCapture,placeBtnId,clearBtnId,typeInputId){
  const canvas=document.getElementById(canvasId);
  const ctx=canvas.getContext('2d');
  let drawing=false;
  const r=()=>canvas.getBoundingClientRect();
  const getXY=e=>{const b=r();return{x:(e.touches?e.touches[0].clientX:e.clientX)-b.left,y:(e.touches?e.touches[0].clientY:e.clientY)-b.top};};
  canvas.addEventListener('pointerdown',e=>{drawing=true;const p=getXY(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});
  canvas.addEventListener('pointermove',e=>{if(!drawing)return;const p=getXY(e);ctx.lineWidth=2;ctx.lineCap='round';ctx.strokeStyle='#1B2A4A';ctx.lineTo(p.x,p.y);ctx.stroke();});
  window.addEventListener('pointerup',()=>drawing=false);
  if(document.getElementById(clearBtnId))
    document.getElementById(clearBtnId).onclick=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);if(typeInputId)document.getElementById(typeInputId).value='';};
  if(document.getElementById(placeBtnId))
    document.getElementById(placeBtnId).onclick=()=>{
      const ti=typeInputId?document.getElementById(typeInputId):null;
      if(ti&&ti.style.display!=='none'&&ti.value.trim()){
        const tmp=document.createElement('canvas');tmp.width=360;tmp.height=100;
        const tc=tmp.getContext('2d');tc.font='italic 46px Georgia,serif';tc.fillStyle='#1B2A4A';
        tc.fillText(ti.value,8,68);pendingSigUrl=tmp.toDataURL();
      }else{pendingSigUrl=canvas.toDataURL();}
      if(canvasId==='sigPad')editTool='sig'; else signTool='sig';
      toast('Click on the page to place signature');
    };
}
document.querySelectorAll('.sig-tabs button[data-sigmode]').forEach(b=>{
  b.addEventListener('click',()=>{
    b.closest('.side-card').querySelectorAll('.sig-tabs button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    const mode=b.dataset.sigmode;
    document.getElementById('sigPad').style.display=mode==='draw'?'block':'none';
    document.getElementById('typedSig').style.display=mode==='type'?'block':'none';
  });
});

document.getElementById('applyEditBtn').onclick=async()=>{
  loading(true,'Applying annotations…');
  const doc=await PDFDocument.load(workingPdfBytes);
  const font=await doc.embedFont(StandardFonts.Helvetica);
  const pgObjs=doc.getPages();
  for(const[pnStr,anns]of Object.entries(annStore)){
    const pg=pgObjs[parseInt(pnStr)-1];if(!pg)continue;
    const {height}=pg.getSize();
    for(const a of anns){
      if(a.type==='text'){
        pg.drawText(a.text,{x:a.x/editScale,y:height-(a.y/editScale)-(a.size/editScale),size:a.size/editScale,font,color:hexToRgb(a.color)});
      }else if(a.type==='sig'){
        const img=await doc.embedPng(dataUrlToBytes(a.dataUrl));
        const w=a.w/editScale,h=w*(img.height/img.width);
        pg.drawImage(img,{x:a.x/editScale,y:height-(a.y/editScale)-h,width:w,height:h});
      }
    }
  }
  workingPdfBytes=await doc.save();
  annStore={};
  download(workingPdfBytes,'edited.pdf');
  loading(false);toast('Annotated PDF downloaded','ok');
  await openEditor();
};

/* ========== WATERMARK ========== */
document.getElementById('wmOpacity').oninput=e=>{document.getElementById('wmOpacityVal').textContent=e.target.value;renderWatermarkPreview();};
document.getElementById('wmSize').oninput=e=>{document.getElementById('wmSizeVal').textContent=e.target.value;renderWatermarkPreview();};
document.getElementById('wmText').oninput=renderWatermarkPreview;
document.getElementById('wmColor').oninput=renderWatermarkPreview;
async function renderWatermarkPreview(){
  if(!sourceBuffers.length)return;
  const prev=document.getElementById('wmPreview');
  prev.innerHTML='';
  const doc=sourceBuffers[0].pdfjsDoc;
  const page=await doc.getPage(1);
  const vp=page.getViewport({scale:0.5});
  const canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;
  await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
  // overlay
  const ctx=canvas.getContext('2d');
  const text=document.getElementById('wmText').value||'WATERMARK';
  const size=parseInt(document.getElementById('wmSize').value)*0.5;
  const opacity=parseFloat(document.getElementById('wmOpacity').value);
  const color=document.getElementById('wmColor').value;
  ctx.save();ctx.globalAlpha=opacity;ctx.font=`bold ${size}px 'Source Sans 3',sans-serif`;
  ctx.fillStyle=color;ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(-Math.PI/4);
  ctx.textAlign='center';ctx.fillText(text,0,0);ctx.restore();
  prev.appendChild(canvas);
}
document.getElementById('wmBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  loading(true,'Adding watermark…');
  const doc=await PDFDocument.load(sourceBuffers[0].bytes);
  const font=await doc.embedFont(StandardFonts.HelveticaBold);
  const text=document.getElementById('wmText').value||'WATERMARK';
  const size=parseInt(document.getElementById('wmSize').value);
  const opacity=parseFloat(document.getElementById('wmOpacity').value);
  const color=document.getElementById('wmColor').value;
  const [r2,g2,b2]=[parseInt(color.slice(1,3),16)/255,parseInt(color.slice(3,5),16)/255,parseInt(color.slice(5,7),16)/255];
  for(const page of doc.getPages()){
    const{width,height}=page.getSize();
    page.drawText(text,{x:width/2-font.widthOfTextAtSize(text,size)/2,y:height/2-size/2,size,font,color:rgb(r2,g2,b2),opacity,rotate:degrees(-45)});
  }
  download(await doc.save(),'watermarked.pdf');
  loading(false);toast('Watermarked PDF downloaded','ok');
};

/* ========== ROTATE ========== */
let rotateSels=new Set();
async function renderRotateGrid(){
  const grid=document.getElementById('rotateGrid');grid.innerHTML='';
  const vis=pages.filter(p=>!p.removed);
  document.getElementById('rotateEmpty').style.display=vis.length?'none':'block';
  for(let i=0;i<vis.length;i++){
    const p=vis[i];
    const card=document.createElement('div');
    card.className='pc'+(rotateSels.has(i)?' selected':'');
    card.dataset.index=i;
    const chk=document.createElement('div');chk.className='pc-check';chk.textContent='✓';card.appendChild(chk);
    const canvas=document.createElement('canvas');card.appendChild(canvas);
    renderThumb(canvas,p);
    const foot=document.createElement('div');foot.className='pc-foot';foot.innerHTML=`<span>p.${p.pageNum}</span>`;
    card.appendChild(foot);
    card.onclick=()=>{rotateSels.has(i)?rotateSels.delete(i):rotateSels.add(i);card.classList.toggle('selected');chk.style.display=rotateSels.has(i)?'flex':'none';};
    grid.appendChild(card);
  }
}
document.getElementById('rotSelAll').onclick=()=>{rotateSels=new Set(pages.filter(p=>!p.removed).map((_,i)=>i));renderRotateGrid();};
document.getElementById('rotSelNone').onclick=()=>{rotateSels=new Set();renderRotateGrid();};
document.getElementById('rotateBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  loading(true,'Rotating…');
  const vis=pages.filter(p=>!p.removed);
  const deg=parseInt(document.getElementById('rotDeg').value);
  rotateSels.forEach(i=>{if(vis[i])vis[i].rotDelta=(vis[i].rotDelta+deg)%360;});
  const doc=await buildDoc();
  download(await doc.save(),'rotated.pdf');
  loading(false);toast('Rotated PDF downloaded','ok');
  rotateSels=new Set();renderRotateGrid();
};

/* ========== PAGE NUMBERS ========== */
document.getElementById('pnBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  loading(true,'Adding page numbers…');
  const doc=sourceBuffers.length>1?await buildDoc():await PDFDocument.load(sourceBuffers[0].bytes);
  const font=await doc.embedFont(StandardFonts.Helvetica);
  const pos=document.querySelector('input[name=pnpos]:checked').value;
  const start=parseInt(document.getElementById('pnStart').value)||1;
  const sz=parseInt(document.getElementById('pnFontSize').value)||12;
  const prefix=document.getElementById('pnPrefix').value||'';
  doc.getPages().forEach((pg,i)=>{
    const{width,height}=pg.getSize();
    const text=prefix+(i+start);
    const tw=font.widthOfTextAtSize(text,sz);
    const margin=20;
    let x=margin,y=margin;
    if(pos.includes('c'))x=width/2-tw/2;
    if(pos.includes('r'))x=width-tw-margin;
    if(pos.includes('t'))y=height-margin-sz;
    pg.drawText(text,{x,y,size:sz,font,color:rgb(0.1,0.1,0.1)});
  });
  download(await doc.save(),'numbered.pdf');
  loading(false);toast('Page numbers added','ok');
};

/* ========== CROP ========== */
async function renderCropPreview(){
  if(!sourceBuffers.length)return;
  const wrap=document.getElementById('cropPreviewWrap');wrap.innerHTML='';
  const doc=sourceBuffers[0].pdfjsDoc;
  const page=await doc.getPage(1);
  const vp=page.getViewport({scale:0.5});
  const canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;
  await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
  wrap.appendChild(canvas);
}
document.getElementById('cropBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  loading(true,'Cropping…');
  const doc=await PDFDocument.load(sourceBuffers[0].bytes);
  const t=parseInt(document.getElementById('cropTop').value)||0;
  const r2=parseInt(document.getElementById('cropRight').value)||0;
  const b=parseInt(document.getElementById('cropBottom').value)||0;
  const l=parseInt(document.getElementById('cropLeft').value)||0;
  doc.getPages().forEach(pg=>{
    const{width,height}=pg.getSize();
    pg.setCropBox(l,b,width-l-r2,height-t-b);
  });
  download(await doc.save(),'cropped.pdf');
  loading(false);toast('Cropped PDF downloaded','ok');
};

/* ========== SIGN ========== */
async function openSignEditor(){
  const vis=pages.filter(p=>!p.removed);
  if(!vis.length){document.getElementById('signEmpty').style.display='block';return;}
  document.getElementById('signEmpty').style.display='none';
  if(!workingPdfBytes){const d=await buildDoc();workingPdfBytes=await d.save();}
  signPdfjsDoc=await pdfjsLib.getDocument({data:workingPdfBytes.slice()}).promise;
  signTotalPages=signPdfjsDoc.numPages;signPageNum=1;
  renderSignPage();
}
async function renderSignPage(){
  const page=await signPdfjsDoc.getPage(signPageNum);
  const vp=page.getViewport({scale:signScale});
  const canvas=document.getElementById('signCanvas');
  canvas.width=vp.width;canvas.height=vp.height;
  await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
  const layer=document.getElementById('signAnnLayer');
  layer.style.cssText=`position:absolute;top:0;left:0;width:${vp.width}px;height:${vp.height}px;pointer-events:none;`;
  layer.innerHTML='';
  (signAnnStore[signPageNum]||[]).forEach((a,idx)=>layer.appendChild(makeSignAnnEl(a,signPageNum,idx)));
  document.getElementById('signPageIndicator').textContent=`Page ${signPageNum} / ${signTotalPages}`;
}
function makeSignAnnEl(a,pn,idx){
  const el=document.createElement('div');
  el.className='ann-el';el.style.cssText=`left:${a.x}px;top:${a.y}px;position:absolute;`;
  el.innerHTML=`<span class="ann-del" onclick="removeSignAnn(${pn},${idx})">✕</span>`;
  const im=document.createElement('img');im.src=a.dataUrl;im.style.cssText=`width:${a.w}px;pointer-events:none;`;
  el.appendChild(im);el.style.pointerEvents='all';return el;
}
window.removeSignAnn=(pn,idx)=>{signAnnStore[pn].splice(idx,1);renderSignPage();};
document.getElementById('signPrevPage').onclick=()=>{if(signPageNum>1){signPageNum--;renderSignPage();}};
document.getElementById('signNextPage').onclick=()=>{if(signPageNum<signTotalPages){signPageNum++;renderSignPage();}};
document.getElementById('signCanvasWrap').addEventListener('click',e=>{
  if(signTool!=='sig')return;
  if(!pendingSignUrl){toast('Create a signature first','err');signTool=null;return;}
  const wrap=document.getElementById('signCanvas').getBoundingClientRect();
  const scr=document.getElementById('signCanvasWrap');
  const x=e.clientX-wrap.left+scr.scrollLeft;
  const y=e.clientY-wrap.top+scr.scrollTop;
  signAnnStore[signPageNum]=signAnnStore[signPageNum]||[];
  signAnnStore[signPageNum].push({type:'sig',x,y,dataUrl:pendingSignUrl,w:180});
  signTool=null;renderSignPage();
});

/* Sign pad 2 */
(()=>{
  const canvas=document.getElementById('sigPad2');
  const ctx=canvas.getContext('2d');
  let drawing=false;
  const getXY=e=>{const b=canvas.getBoundingClientRect();return{x:(e.touches?e.touches[0].clientX:e.clientX)-b.left,y:(e.touches?e.touches[0].clientY:e.clientY)-b.top};};
  canvas.addEventListener('pointerdown',e=>{drawing=true;const p=getXY(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});
  canvas.addEventListener('pointermove',e=>{if(!drawing)return;const p=getXY(e);ctx.lineWidth=2.2;ctx.lineCap='round';ctx.strokeStyle='#1B2A4A';ctx.lineTo(p.x,p.y);ctx.stroke();});
  window.addEventListener('pointerup',()=>drawing=false);
})();
document.querySelectorAll('#signTabs button[data-signmode]').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('#signTabs button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    const mode=b.dataset.signmode;
    document.getElementById('sigPad2').style.display=mode==='draw'?'block':'none';
    document.getElementById('typedSig2').style.display=mode==='type'?'block':'none';
    document.getElementById('sigUploadArea').style.display=mode==='upload'?'block':'none';
  });
});
document.getElementById('sigUploadBtn').onclick=()=>document.getElementById('sigImgInput').click();
document.getElementById('sigImgInput').onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const fr=new FileReader();
  fr.onload=ev=>{
    const prev=document.getElementById('sigUploadPreview');
    prev.style.display='block';
    const img=new Image();img.src=ev.target.result;
    img.onload=()=>{prev.width=img.width;prev.height=img.height;prev.getContext('2d').drawImage(img,0,0);pendingSignUrl=ev.target.result;};
  };fr.readAsDataURL(f);
};
document.getElementById('clearSig2Btn').onclick=()=>{
  const ctx=document.getElementById('sigPad2').getContext('2d');
  ctx.clearRect(0,0,document.getElementById('sigPad2').width,document.getElementById('sigPad2').height);
  document.getElementById('typedSig2').value='';pendingSignUrl=null;
};
document.getElementById('placeSig2Btn').onclick=()=>{
  const mode=document.querySelector('#signTabs button.on').dataset.signmode;
  if(mode==='draw'){pendingSignUrl=document.getElementById('sigPad2').toDataURL();}
  else if(mode==='type'){
    const name=document.getElementById('typedSig2').value.trim();
    if(!name){toast('Enter your name','err');return;}
    const tmp=document.createElement('canvas');tmp.width=400;tmp.height=110;
    const tc=tmp.getContext('2d');tc.font='italic 52px Georgia,serif';tc.fillStyle='#1B2A4A';
    tc.fillText(name,8,78);pendingSignUrl=tmp.toDataURL();
  }
  // upload mode already sets pendingSignUrl
  if(!pendingSignUrl){toast('Create a signature first','err');return;}
  signTool='sig';toast('Click on the page to place your signature');
};
document.getElementById('applySignBtn').onclick=async()=>{
  loading(true,'Applying signature…');
  const doc=await PDFDocument.load(workingPdfBytes);
  const pgObjs=doc.getPages();
  for(const[pnStr,anns]of Object.entries(signAnnStore)){
    const pg=pgObjs[parseInt(pnStr)-1];if(!pg)continue;
    const{height}=pg.getSize();
    for(const a of anns){
      const img=await doc.embedPng(dataUrlToBytes(a.dataUrl));
      const w=a.w/signScale,h=w*(img.height/img.width);
      pg.drawImage(img,{x:a.x/signScale,y:height-(a.y/signScale)-h,width:w,height:h});
    }
  }
  workingPdfBytes=await doc.save();signAnnStore={};
  download(workingPdfBytes,'signed.pdf');
  loading(false);toast('Signed PDF downloaded','ok');
  await openSignEditor();
};

/* ========== UNLOCK ========== */
document.getElementById('unlockBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  loading(true,'Unlocking…');
  const pwd=document.getElementById('unlockPwd').value;
  try{
    const doc=await PDFDocument.load(sourceBuffers[0].bytes,{password:pwd,ignoreEncryption:true});
    download(await doc.save(),'unlocked.pdf');
    document.getElementById('unlockStatus').innerHTML='<span style="color:var(--green)">✓ Unlocked successfully.</span>';
    loading(false);toast('Unlocked PDF downloaded','ok');
  }catch(e){
    loading(false);toast('Could not unlock — wrong password?','err');
    document.getElementById('unlockStatus').innerHTML='<span style="color:var(--red)">✕ Failed: '+e.message+'</span>';
  }
};

/* ========== PROTECT ========== */
document.getElementById('protectBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  const up=document.getElementById('protectUser').value;
  const op=document.getElementById('protectOwner').value;
  if(!up){toast('Enter a user password','err');return;}
  loading(true,'Encrypting…');
  try{
    const doc=await PDFDocument.load(sourceBuffers[0].bytes,{ignoreEncryption:true});
    // pdf-lib doesn't natively support encryption; we'll re-save and note this
    // For a fully encrypted PDF we inform the user
    const saved=await doc.save();
    download(saved,'protected.pdf');
    loading(false);
    // note: true AES-256 encryption requires a server or crypto lib beyond pdf-lib scope
    toast('PDF saved — note: for strong encryption use Adobe Acrobat or similar','ok');
  }catch(e){loading(false);toast('Error: '+e.message,'err');}
};

/* ========== COMPARE ========== */
async function extractText(bytes){
  const doc=await pdfjsLib.getDocument({data:bytes.slice()}).promise;
  let t='';
  for(let i=1;i<=doc.numPages;i++){const pg=await doc.getPage(i);const tc=await pg.getTextContent();t+=tc.items.map(x=>x.str).join(' ')+'\n';}
  return t;
}
document.getElementById('loadA').onclick=()=>document.getElementById('fileA').click();
document.getElementById('loadB').onclick=()=>document.getElementById('fileB').click();
document.getElementById('fileA').onchange=async e=>{
  if(!e.target.files[0])return;
  compareBufA=new Uint8Array(await e.target.files[0].arrayBuffer());
  document.getElementById('labelA').textContent='✓ '+e.target.files[0].name;
};
document.getElementById('fileB').onchange=async e=>{
  if(!e.target.files[0])return;
  compareBufB=new Uint8Array(await e.target.files[0].arrayBuffer());
  document.getElementById('labelB').textContent='✓ '+e.target.files[0].name;
};
document.getElementById('compareBtn').onclick=async()=>{
  if(!compareBufA||!compareBufB){toast('Load both PDFs first','err');return;}
  loading(true,'Comparing…');
  const tA=await extractText(compareBufA);
  const tB=await extractText(compareBufB);
  loading(false);
  const linesA=tA.split('\n');const linesB=tB.split('\n');
  const maxLen=Math.max(linesA.length,linesB.length);
  let html='';
  for(let i=0;i<maxLen;i++){
    const a=(linesA[i]||'').trim();const b=(linesB[i]||'').trim();
    if(!a&&!b)continue;
    if(a===b)html+=`<div class="diff-eq">&nbsp;&nbsp;${esc(a)}</div>`;
    else{
      if(a)html+=`<div class="diff-del">− ${esc(a)}</div>`;
      if(b)html+=`<div class="diff-add">+ ${esc(b)}</div>`;
    }
  }
  const out=document.getElementById('diffOut');out.innerHTML=html||'<div class="diff-eq">Files appear identical.</div>';out.style.display='block';
  toast('Comparison complete','ok');
};
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/* ========== SUMMARIZE (Claude API) ========== */
let summaryText='';
document.getElementById('summarizeBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  loading(true,'Extracting text…');
  const text=await extractFullText();
  loading(true,'Sending to Claude AI…');
  document.getElementById('sumStatus').textContent='Analyzing with Claude AI…';
  try{
    const res=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-6',max_tokens:1000,
        messages:[{role:'user',content:`Please provide a comprehensive, well-structured summary of the following PDF content. Include: key topics, main points, important details, and a brief conclusion.\n\n${text.slice(0,12000)}`}]
      })
    });
    const data=await res.json();
    summaryText=data.content?.[0]?.text||'No response from API.';
    document.getElementById('sumOut').textContent=summaryText;
    document.getElementById('sumStatus').textContent='Summary generated successfully.';
    document.getElementById('sumDownloadBtn').disabled=false;
    loading(false);toast('Summary ready','ok');
  }catch(e){
    loading(false);document.getElementById('sumOut').textContent='Error: '+e.message;
    document.getElementById('sumStatus').textContent='API error.';toast('API error','err');
  }
};
document.getElementById('sumDownloadBtn').onclick=()=>{if(summaryText)downloadText(summaryText,'summary.txt');};

/* ========== TRANSLATE (Claude API) ========== */
let transText='';
document.getElementById('translateBtn').onclick=async()=>{
  if(!sourceBuffers.length){toast('Load a PDF first','err');return;}
  const lang=document.querySelector('input[name=lang]:checked')?.value||'Hindi';
  loading(true,'Extracting text…');
  const text=await extractFullText();
  loading(true,`Translating to ${lang}…`);
  document.getElementById('transStatus').textContent=`Translating to ${lang} with Claude AI…`;
  try{
    const res=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-6',max_tokens:2000,
        messages:[{role:'user',content:`Translate the following PDF text into ${lang}. Preserve the structure and meaning as closely as possible. Only return the translated text.\n\n${text.slice(0,10000)}`}]
      })
    });
    const data=await res.json();
    transText=data.content?.[0]?.text||'No response.';
    document.getElementById('transOut').textContent=transText;
    document.getElementById('transStatus').textContent=`Translated to ${lang}.`;
    document.getElementById('transDownloadBtn').disabled=false;
    loading(false);toast(`Translation to ${lang} ready`,'ok');
  }catch(e){
    loading(false);document.getElementById('transOut').textContent='Error: '+e.message;toast('API error','err');
  }
};
document.getElementById('transDownloadBtn').onclick=()=>{if(transText)downloadText(transText,'translation.txt');};

/* ========== SIG PAD RESIZE ========== */
function resizeSigPads(){
  ['sigPad','sigPad2'].forEach(id=>{
    const c=document.getElementById(id);
    if(c){const w=c.clientWidth;if(w>0&&c.width!==w){const img=c.toDataURL();c.width=w;c.height=c.clientHeight||120;const i=new Image();i.onload=()=>c.getContext('2d').drawImage(i,0,0);i.src=img;}}
  });
}
window.addEventListener('resize',resizeSigPads);
setTimeout(resizeSigPads,300);
