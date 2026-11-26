(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const viewCanvas = $('scene-canvas');
  const viewCtx = viewCanvas.getContext('2d', { willReadFrequently: true });
  const sourceCanvas = $('source-canvas');
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const mapCanvas = $('map-canvas');
  const mapCtx = mapCanvas.getContext('2d');
  const video = $('camera-video');
  const STORAGE_KEY = 'spatialsync-coordinate-reader-v1';
  const cornerNames = ['Far-left', 'Far-right', 'Near-right', 'Near-left'];
  const cornerShort = ['1', '2', '3', '4'];
  const state = {
    sourceType: 'demo',
    sourceImage: null,
    videoStream: null,
    imageUrl: null,
    calibrationPoints: [],
    calibrated: false,
    calibrationMode: false,
    targetPoint: null,
    coordinate: null,
    homography: null,
    history: [],
    renderRequested: false,
    sourceReady: true,
  };

  const saved = readSavedState();
  if (saved) {
    if (Number.isFinite(saved.width) && saved.width >= 10 && saved.width <= 500) $('mat-width').value = saved.width;
    if (Number.isFinite(saved.depth) && saved.depth >= 10 && saved.depth <= 500) $('mat-depth').value = saved.depth;
    if (Array.isArray(saved.history)) state.history = saved.history.filter((item) => item && Number.isFinite(item.x) && Number.isFinite(item.z)).slice(0, 50);
  }

  createDemoImage();
  bindEvents();
  updateAll();
  resizeCanvases();
  requestAnimationFrame(renderLoop);

  function readSavedState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function persistState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        width: dimensions().width,
        depth: dimensions().depth,
        history: state.history.slice(0, 50),
      }));
    } catch (_) { /* Private browsing may disable local storage. */ }
  }

  function dimensions() {
    const width = Number.parseFloat($('mat-width').value);
    const depth = Number.parseFloat($('mat-depth').value);
    return { width, depth };
  }

  function validDimensions() {
    const { width, depth } = dimensions();
    return Number.isFinite(width) && Number.isFinite(depth) && width >= 10 && depth >= 10 && width <= 500 && depth <= 500;
  }

  function bindEvents() {
    $('calibrate-mat').addEventListener('click', startCalibration);
    $('undo-corner').addEventListener('click', undoCorner);
    $('reset-mat').addEventListener('click', resetCalibration);
    $('detect-target').addEventListener('click', detectRedTarget);
    $('add-reading').addEventListener('click', addReading);
    $('export-log').addEventListener('click', exportLog);
    $('load-demo').addEventListener('click', loadDemo);
    $('start-camera').addEventListener('click', startCamera);
    $('stop-camera').addEventListener('click', stopCamera);
    $('image-upload').addEventListener('change', handleImageUpload);
    $('mat-width').addEventListener('change', handleDimensionsChange);
    $('mat-depth').addEventListener('change', handleDimensionsChange);
    viewCanvas.addEventListener('pointerdown', handleCanvasClick);
    window.addEventListener('resize', resizeCanvases);
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(resizeCanvases);
      observer.observe($('stage'));
      observer.observe($('map-canvas').parentElement);
    }
    window.addEventListener('pagehide', stopCamera);
  }

  function createDemoImage() {
    const demo = document.createElement('canvas');
    demo.width = 1200;
    demo.height = 760;
    const ctx = demo.getContext('2d');
    ctx.fillStyle = '#344553';
    ctx.fillRect(0, 0, demo.width, demo.height);
    ctx.fillStyle = '#2a3a47';
    ctx.fillRect(0, 0, demo.width, 120);
    for (let x = 0; x < demo.width; x += 120) {
      ctx.fillStyle = x % 240 === 0 ? 'rgba(191,218,228,.035)' : 'rgba(7,17,24,.05)';
      ctx.fillRect(x, 0, 60, demo.height);
    }
    const corners = [{x:145,y:105},{x:1060,y:132},{x:1000,y:670},{x:202,y:644}];
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 38;
    ctx.shadowOffsetY = 17;
    ctx.beginPath();
    corners.forEach((p, i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
    ctx.closePath();
    ctx.fillStyle = '#e8edf0';
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    corners.forEach((p, i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#dce5e9';
    ctx.fillRect(0, 0, demo.width, demo.height);
    const lerpPoint = (a, b, t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
    for (let n = 0; n <= 12; n++) {
      const t = n / 12;
      const left = lerpPoint(corners[0], corners[3], t);
      const right = lerpPoint(corners[1], corners[2], t);
      const top = lerpPoint(corners[0], corners[1], t);
      const bottom = lerpPoint(corners[3], corners[2], t);
      ctx.beginPath(); ctx.moveTo(left.x,left.y); ctx.lineTo(right.x,right.y);
      ctx.strokeStyle = n % 3 === 0 ? 'rgba(28,118,138,.33)' : 'rgba(38,103,119,.18)';
      ctx.lineWidth = n % 3 === 0 ? 2 : 1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(top.x,top.y); ctx.lineTo(bottom.x,bottom.y); ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath();
    corners.forEach((p, i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(250,253,255,.9)'; ctx.lineWidth = 3; ctx.stroke();
    const marker = {u:.63,v:.56};
    const markerX = demo.width * marker.u, markerY = demo.height * marker.v;
    const gradient = ctx.createRadialGradient(markerX,markerY,3,markerX,markerY,35);
    gradient.addColorStop(0,'rgba(255,81,92,.42)'); gradient.addColorStop(1,'rgba(255,81,92,0)');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(markerX,markerY,35,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#f34b55'; ctx.strokeStyle = '#fff5f3'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(markerX,markerY,17,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(13,29,40,.8)';
    ctx.font = '600 20px Inter, system-ui, sans-serif';
    ctx.fillText('SPATIAL MAT · 60 × 40 cm', 36, 52);
    ctx.font = '500 15px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(241,247,250,.68)';
    ctx.fillText('Sample workspace · click calibrate to begin', 36, 78);
    state.sourceImage = demo;
    state.sourceReady = true;
  }

  function loadDemo() {
    stopCamera();
    createDemoImage();
    state.sourceType = 'demo';
    $('source-state-label').textContent = 'Demo mat loaded';
    $('stage-source-label').textContent = 'DEMO IMAGE';
    $('source-state-dot').style.background = 'var(--green)';
    resetCalibration(false);
    toast('Demo mat loaded. Calibrate its four visible corners to try a reading.');
    updateAll();
  }

  function handleImageUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Choose an image file.', 'error'); return; }
    stopCamera();
    const nextUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
      state.imageUrl = nextUrl;
      state.sourceImage = image;
      state.sourceReady = true;
      state.sourceType = 'image';
      $('source-state-label').textContent = file.name.length > 25 ? `${file.name.slice(0,22)}…` : file.name;
      $('stage-source-label').textContent = 'UPLOADED IMAGE';
      $('source-state-dot').style.background = 'var(--cyan)';
      resetCalibration(false);
      toast('Image ready. Calibrate the mat corners in the photo.', 'success');
      updateAll();
    };
    image.onerror = () => { URL.revokeObjectURL(nextUrl); toast('That image could not be opened.', 'error'); };
    image.src = nextUrl;
    event.target.value = '';
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Camera access needs a secure HTTPS page and a supported browser.', 'error');
      return;
    }
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      state.videoStream = stream;
      video.srcObject = stream;
      await video.play();
      state.sourceType = 'camera';
      state.sourceImage = video;
      state.sourceReady = true;
      $('source-state-label').textContent = 'Live camera';
      $('stage-source-label').textContent = 'LIVE CAMERA';
      $('source-state-dot').style.background = 'var(--green)';
      $('start-camera').classList.add('hidden');
      $('stop-camera').classList.remove('hidden');
      resetCalibration(false);
      toast('Camera is on. Keep the full mat visible while you calibrate.', 'success');
      updateAll();
    } catch (error) {
      stopCamera();
      const message = error && error.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in your browser, or upload a mat photo.'
        : 'Camera could not start. Use a secure connection or upload a mat photo instead.';
      toast(message, 'error');
    }
  }

  function stopCamera() {
    const cameraWasActive = state.sourceType === 'camera';
    if (state.videoStream) state.videoStream.getTracks().forEach((track) => track.stop());
    state.videoStream = null;
    video.pause();
    video.srcObject = null;
    $('start-camera').classList.remove('hidden');
    $('stop-camera').classList.add('hidden');
    if (cameraWasActive) {
      state.sourceType = 'demo';
      createDemoImage();
      $('source-state-label').textContent = 'Demo mat loaded';
      $('stage-source-label').textContent = 'DEMO IMAGE';
      $('source-state-dot').style.background = 'var(--green)';
      resetCalibration(false);
    }
  }

  function startCalibration() {
    if (!validDimensions()) { toast('Enter a mat width and depth between 10 and 500 cm.', 'error'); return; }
    state.calibrationPoints = [];
    state.calibrated = false;
    state.calibrationMode = true;
    state.targetPoint = null;
    state.coordinate = null;
    state.homography = null;
    updateAll();
    toast('Tap the four mat corners in the order shown.');
  }

  function resetCalibration(showMessage = true) {
    state.calibrationPoints = [];
    state.calibrated = false;
    state.calibrationMode = false;
    state.targetPoint = null;
    state.coordinate = null;
    state.homography = null;
    updateAll();
    if (showMessage) toast('Calibration cleared.');
  }

  function undoCorner() {
    if (state.calibrated) {
      state.calibrated = false;
      state.calibrationMode = true;
      state.targetPoint = null;
      state.coordinate = null;
    }
    if (state.calibrationPoints.length) state.calibrationPoints.pop();
    state.homography = null;
    updateAll();
  }

  function handleDimensionsChange() {
    if (!validDimensions()) {
      toast('Mat dimensions must be from 10 to 500 cm.', 'error');
      return;
    }
    if (state.calibrated) state.homography = buildHomography();
    if (state.calibrated && state.targetPoint) readPoint(state.targetPoint, false);
    persistState();
    updateAll();
  }

  function handleCanvasClick(event) {
    if (!state.sourceReady) return;
    const rect = viewCanvas.getBoundingClientRect();
    const point = {u:clamp((event.clientX-rect.left)/rect.width,0,1),v:clamp((event.clientY-rect.top)/rect.height,0,1)};
    if (state.calibrationMode) {
      if (state.calibrationPoints.length >= 4) return;
      state.calibrationPoints.push(point);
      if (state.calibrationPoints.length === 4) finishCalibration();
      else updateAll();
      return;
    }
    if (!state.calibrated) {
      toast('Calibrate the mat before reading a point.');
      return;
    }
    readPoint(point, true);
  }

  function finishCalibration() {
    const h = buildHomography();
    if (!h) {
      state.calibrationPoints.pop();
      state.calibrated = false;
      state.calibrationMode = true;
      toast('Those corners are too close together. Undo and select the mat corners again.', 'error');
      updateAll();
      return;
    }
    state.homography = h;
    state.calibrated = true;
    state.calibrationMode = false;
    toast('Mat calibrated. Click the target or use Detect red target.', 'success');
    updateAll();
  }

  function buildHomography() {
    if (state.calibrationPoints.length !== 4 || !validDimensions()) return null;
    const {width,depth} = dimensions();
    const destination = [{x:0,z:depth},{x:width,z:depth},{x:width,z:0},{x:0,z:0}];
    const equations = [];
    state.calibrationPoints.forEach((point,index) => {
      const {u,v} = point, {x,z} = destination[index];
      equations.push([u,v,1,0,0,0,-u*x,-v*x,x]);
      equations.push([0,0,0,u,v,1,-u*z,-v*z,z]);
    });
    const solved = solveLinearSystem(equations);
    return solved && solved.every(Number.isFinite) ? solved : null;
  }

  function solveLinearSystem(matrix) {
    const n = matrix.length;
    for (let column=0; column<n; column++) {
      let pivot = column;
      for (let row=column+1; row<n; row++) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
      if (Math.abs(matrix[pivot][column]) < 1e-10) return null;
      [matrix[column],matrix[pivot]] = [matrix[pivot],matrix[column]];
      const divisor = matrix[column][column];
      for (let j=column; j<=n; j++) matrix[column][j] /= divisor;
      for (let row=0; row<n; row++) {
        if (row===column) continue;
        const factor=matrix[row][column];
        for (let j=column; j<=n; j++) matrix[row][j] -= factor*matrix[column][j];
      }
    }
    return matrix.map((row)=>row[n]);
  }

  function mapPoint(point) {
    const h = state.homography || buildHomography();
    if (!h) return null;
    const {u,v} = point;
    const divisor = h[6]*u+h[7]*v+1;
    if (Math.abs(divisor)<1e-10) return null;
    return {x:(h[0]*u+h[1]*v+h[2])/divisor,z:(h[3]*u+h[4]*v+h[5])/divisor};
  }

  function readPoint(point, showToast = true) {
    const mapped = mapPoint(point);
    const {width,depth} = dimensions();
    if (!mapped || mapped.x < -1 || mapped.z < -1 || mapped.x > width+1 || mapped.z > depth+1) {
      state.targetPoint = point;
      state.coordinate = null;
      updateAll();
      if (showToast) toast('The point is outside the calibrated mat. Tap a point inside its corners.', 'error');
      return;
    }
    state.targetPoint = point;
    state.coordinate = {x:clamp(mapped.x,0,width),y:0,z:clamp(mapped.z,0,depth)};
    updateAll();
    if (showToast) toast(`Position read: X ${state.coordinate.x.toFixed(1)} cm, Z ${state.coordinate.z.toFixed(1)} cm.`, 'success');
  }

  function detectRedTarget() {
    if (!state.calibrated) { toast('Calibrate the mat first.', 'error'); return; }
    if (state.sourceType === 'camera' && video.readyState < 2) { toast('Wait for the camera image to appear.', 'error'); return; }
    const width=320,height=240;
    const sample=document.createElement('canvas'); sample.width=width; sample.height=height;
    const ctx=sample.getContext('2d',{willReadFrequently:true});
    try { ctx.drawImage(sourceCanvas,0,0,width,height); }
    catch (_) { toast('No image is available to scan yet.', 'error'); return; }
    const data=ctx.getImageData(0,0,width,height).data;
    const mask=new Uint8Array(width*height);
    for (let i=0,p=0; i<data.length; i+=4,p++) {
      const r=data[i],g=data[i+1],b=data[i+2];
      if (r>125 && r>g*1.45 && r>b*1.35 && g<155) mask[p]=1;
    }
    const visited=new Uint8Array(width*height);
    const queue=new Int32Array(width*height);
    let bestCount=0,bestX=0,bestY=0;
    for (let index=0;index<mask.length;index++) {
      if (!mask[index] || visited[index]) continue;
      let head=0,tail=0,sumX=0,sumY=0;
      queue[tail++]=index; visited[index]=1;
      while(head<tail) {
        const p=queue[head++],x=p%width,y=(p/width)|0;
        sumX+=x; sumY+=y;
        const neighbors=[p-1,p+1,p-width,p+width];
        for(let k=0;k<4;k++) {
          const q=neighbors[k];
          if(q<0||q>=mask.length) continue;
          if((k===0&&x===0)||(k===1&&x===width-1)) continue;
          if(mask[q]&&!visited[q]) {visited[q]=1;queue[tail++]=q;}
        }
      }
      if(tail>bestCount) {bestCount=tail;bestX=sumX/tail;bestY=sumY/tail;}
    }
    if(bestCount<15) { toast('No red target found. Place a bright red marker on the mat, or tap the point manually.', 'error'); return; }
    const point={u:bestX/width,v:bestY/height};
    readPoint(point,true);
  }

  function addReading() {
    if (!state.coordinate) return;
    const row={id:Date.now()+Math.random(),time:new Date().toISOString(),x:state.coordinate.x,y:state.coordinate.y,z:state.coordinate.z,width:dimensions().width,depth:dimensions().depth};
    state.history.unshift(row);
    state.history=state.history.slice(0,50);
    persistState();
    updateLog();
    toast('Reading added to this browser’s session log.', 'success');
  }

  function exportLog() {
    if (!state.history.length) return;
    const rows=[['timestamp','x_cm','y_cm','z_cm','mat_width_cm','mat_depth_cm']];
    state.history.forEach((item)=>rows.push([item.time,item.x.toFixed(2),item.y.toFixed(2),item.z.toFixed(2),item.width,item.depth]));
    const csv=rows.map((row)=>row.map(csvCell).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download='spatialsync-coordinate-readings.csv';link.click();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) { return `"${String(value).replaceAll('"','""')}"`; }

  function updateAll() {
    updateInstructions();
    updateCoordinateReadout();
    updateLog();
    drawMap();
    scheduleRender();
    $('undo-corner').disabled=state.calibrationPoints.length===0;
    $('detect-target').disabled=!state.calibrated;
    $('add-reading').disabled=!state.coordinate;
    $('calibrate-mat').textContent=state.calibrated?'Recalibrate mat':'Calibrate mat';
  }

  function updateInstructions() {
    const n=state.calibrationPoints.length;
    $('corner-count').textContent=`${n} / 4 corners`;
    const badge=$('workflow-chip');
    const label=$('workflow-label');
    const icon=$('instruction-icon');
    const text=$('instruction-text');
    const stageText=$('stage-hud-text');
    if(state.calibrationMode) {
      badge.classList.remove('is-ready'); label.textContent=`Corner ${Math.min(n+1,4)} of 4`;
      icon.classList.remove('done'); icon.textContent=String(Math.min(n+1,4));
      text.textContent=`Click the ${cornerNames[n]||'last'} corner of the mat. Keep the full mat visible and tap near the outer edge.`;
      stageText.textContent=`Click ${cornerNames[n]||'last'} corner · ${n+1}/4`;
    } else if(state.calibrated) {
      badge.classList.add('is-ready'); label.textContent='Mat calibrated';
      icon.classList.add('done'); icon.textContent='✓';
      text.textContent='Mat is calibrated. Click the center of a point or choose Detect red target. X grows right; Z grows from the near edge toward the far edge.';
      stageText.textContent=state.coordinate?'Position selected':'Click a point to read X / Z';
    } else {
      badge.classList.remove('is-ready'); label.textContent='Set up your mat';
      icon.classList.remove('done'); icon.textContent='1';
      text.textContent='Set your mat size, then select Calibrate mat and click the four corners clockwise, starting at the far-left corner.';
      stageText.textContent='Waiting for calibration';
    }
    $('readout-status').classList.toggle('ready',!!state.coordinate);
    $('readout-status').innerHTML=state.coordinate?'<span class="status-dot"></span>Position read':'<span class="status-dot"></span>Waiting';
  }

  function updateCoordinateReadout() {
    if(!state.coordinate) {
      $('coord-x').textContent='—';$('coord-z').textContent='—';
      $('meter-readout').innerHTML='Meters: <span>—</span>';
      return;
    }
    const {x,y,z}=state.coordinate;
    $('coord-x').textContent=x.toFixed(1);$('coord-y').textContent=y.toFixed(1);$('coord-z').textContent=z.toFixed(1);
    $('meter-readout').innerHTML=`Meters: <span>X ${ (x/100).toFixed(3)} · Y ${(y/100).toFixed(3)} · Z ${(z/100).toFixed(3)}</span>`;
  }

  function updateLog() {
    const list=$('log-list');
    $('log-count').textContent=String(state.history.length);
    $('export-log').disabled=state.history.length===0;
    if(!state.history.length) {
      list.innerHTML='<div class="empty-log"><span class="empty-log-mark">◌</span><span>Saved readings appear here.</span></div>';
      return;
    }
    list.replaceChildren();
    state.history.slice(0,8).forEach((row)=>{
      const line=document.createElement('div');line.className='log-row';
      const time=document.createElement('span');time.className='log-time';
      const parsedTime=new Date(row.time);
      time.textContent=Number.isNaN(parsedTime.getTime())?'—':parsedTime.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      line.appendChild(time);
      [['X',row.x],['Y',row.y],['Z',row.z]].forEach(([axis,value])=>{
        const cell=document.createElement('span');cell.className='log-coordinate';
        const label=document.createElement('b');label.textContent=axis;
        cell.append(label,document.createTextNode(` ${Number(value).toFixed(1)}`));
        line.appendChild(cell);
      });
      list.appendChild(line);
    });
  }

  function drawMap() {
    const {width,depth}=dimensions();
    const rect=mapCanvas.getBoundingClientRect();
    if(!rect.width||!rect.height) return;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const bitmapW=Math.max(1,Math.round(rect.width*dpr)),bitmapH=Math.max(1,Math.round(rect.height*dpr));
    if(mapCanvas.width!==bitmapW||mapCanvas.height!==bitmapH) {mapCanvas.width=bitmapW;mapCanvas.height=bitmapH;}
    mapCtx.setTransform(dpr,0,0,dpr,0,0);
    const w=rect.width,h=rect.height;
    mapCtx.clearRect(0,0,w,h);
    mapCtx.fillStyle='#0a1420';mapCtx.fillRect(0,0,w,h);
    if(!validDimensions()) return;
    const margin={left:39,right:20,top:16,bottom:31};
    const scale=Math.min((w-margin.left-margin.right)/width,(h-margin.top-margin.bottom)/depth);
    const matW=width*scale,matH=depth*scale;
    const x0=margin.left+(w-margin.left-margin.right-matW)/2;
    const y0=margin.top+(h-margin.top-margin.bottom-matH)/2;
    mapCtx.fillStyle='#112436';mapCtx.fillRect(x0,y0,matW,matH);
    const step=width>160||depth>160?20:10;
    mapCtx.lineWidth=1;
    for(let x=0;x<=width;x+=step) {
      const px=x0+x*scale; mapCtx.beginPath();mapCtx.moveTo(px,y0);mapCtx.lineTo(px,y0+matH);
      mapCtx.strokeStyle=x%50===0?'rgba(88,181,194,.32)':'rgba(128,158,184,.13)';mapCtx.stroke();
    }
    for(let z=0;z<=depth;z+=step) {
      const py=y0+matH-z*scale;mapCtx.beginPath();mapCtx.moveTo(x0,py);mapCtx.lineTo(x0+matW,py);
      mapCtx.strokeStyle=z%50===0?'rgba(88,181,194,.32)':'rgba(128,158,184,.13)';mapCtx.stroke();
    }
    mapCtx.strokeStyle='rgba(107,225,229,.7)';mapCtx.lineWidth=1.5;mapCtx.strokeRect(x0,y0,matW,matH);
    mapCtx.fillStyle='#90a5ba';mapCtx.font='11px Inter,system-ui,sans-serif';mapCtx.textAlign='center';mapCtx.textBaseline='top';
    for(let x=0;x<=width;x+=step) {const px=x0+x*scale;if(px>=x0-1&&px<=x0+matW+1)mapCtx.fillText(String(x),px,y0+matH+7);}
    mapCtx.textAlign='right';mapCtx.textBaseline='middle';
    for(let z=0;z<=depth;z+=step) {const py=y0+matH-z*scale;if(py>=y0-1&&py<=y0+matH+1)mapCtx.fillText(String(z),x0-8,py);}
    mapCtx.textAlign='left';mapCtx.textBaseline='middle';mapCtx.fillStyle='#56d7e3';mapCtx.font='700 11px Inter,system-ui,sans-serif';mapCtx.fillText('Z',x0-25,y0-2);
    mapCtx.textAlign='right';mapCtx.textBaseline='top';mapCtx.fillText('X (cm)',x0+matW,y0+matH+21);
    mapCtx.textAlign='left';mapCtx.textBaseline='bottom';mapCtx.fillStyle='#92a5b8';mapCtx.font='10px Inter,system-ui,sans-serif';mapCtx.fillText('ORIGIN',x0+4,y0+matH-5);
    if(state.coordinate) {
      const px=x0+state.coordinate.x*scale,py=y0+matH-state.coordinate.z*scale;
      mapCtx.beginPath();mapCtx.arc(px,py,11,0,Math.PI*2);mapCtx.fillStyle='rgba(255,109,114,.18)';mapCtx.fill();
      mapCtx.beginPath();mapCtx.arc(px,py,5,0,Math.PI*2);mapCtx.fillStyle='#ff6d72';mapCtx.fill();mapCtx.strokeStyle='#fff2f1';mapCtx.lineWidth=1.5;mapCtx.stroke();
    }
    mapCtx.textAlign='left';mapCtx.textBaseline='top';
    mapCtx.beginPath();mapCtx.moveTo(x0,y0+matH);mapCtx.lineTo(x0+19,y0+matH);mapCtx.strokeStyle='#56d7e3';mapCtx.lineWidth=2;mapCtx.stroke();
    mapCtx.beginPath();mapCtx.moveTo(x0,y0+matH);mapCtx.lineTo(x0,y0+matH-19);mapCtx.stroke();
    mapCtx.fillStyle='#56d7e3';mapCtx.font='700 10px Inter,system-ui,sans-serif';mapCtx.fillText('X',x0+21,y0+matH-8);mapCtx.fillText('Z',x0-4,y0+matH-31);
  }

  function scheduleRender() {
    if(!state.renderRequested) {state.renderRequested=true;requestAnimationFrame(()=>{state.renderRequested=false;drawScene();});}
  }

  function resizeCanvases() {
    const rect=viewCanvas.getBoundingClientRect();
    if(rect.width&&rect.height) {
      const dpr=Math.min(window.devicePixelRatio||1,2);
      const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
      if(viewCanvas.width!==w||viewCanvas.height!==h) {viewCanvas.width=w;viewCanvas.height=h;}
      viewCtx.setTransform(dpr,0,0,dpr,0,0);
    }
    scheduleRender();drawMap();
  }

  function renderLoop() {
    if(state.sourceType==='camera' && video.readyState>=2) scheduleRender();
    requestAnimationFrame(renderLoop);
  }

  function drawScene() {
    const rect=viewCanvas.getBoundingClientRect();
    if(!rect.width||!rect.height) return;
    const dpr=Math.min(window.devicePixelRatio||1,2),w=rect.width,h=rect.height;
    viewCtx.setTransform(dpr,0,0,dpr,0,0);
    viewCtx.clearRect(0,0,w,h);
    viewCtx.fillStyle='#0b1420';viewCtx.fillRect(0,0,w,h);
    if(state.sourceType==='camera' && video.readyState>=2) {
      try { sourceCanvas.width=viewCanvas.width;sourceCanvas.height=viewCanvas.height;sourceCtx.drawImage(video,0,0,sourceCanvas.width,sourceCanvas.height);viewCtx.drawImage(video,0,0,w,h); }
      catch (_) { /* Camera may not have delivered its first frame. */ }
    } else if(state.sourceImage) {
      try { sourceCanvas.width=viewCanvas.width;sourceCanvas.height=viewCanvas.height;sourceCtx.drawImage(state.sourceImage,0,0,sourceCanvas.width,sourceCanvas.height);viewCtx.drawImage(state.sourceImage,0,0,w,h); }
      catch (_) { drawEmptyScene(w,h); }
    } else drawEmptyScene(w,h);
    drawCalibrationOverlay(w,h);
  }

  function drawEmptyScene(w,h) {
    viewCtx.fillStyle='#0b1420';viewCtx.fillRect(0,0,w,h);
    viewCtx.fillStyle='#a6b5c5';viewCtx.textAlign='center';viewCtx.font='600 14px Inter,system-ui,sans-serif';
    viewCtx.fillText('Start the camera or upload an image of your mat',w/2,h/2);
  }

  function drawCalibrationOverlay(w,h) {
    const pts=state.calibrationPoints;
    if(pts.length>1) {
      viewCtx.beginPath();viewCtx.moveTo(pts[0].u*w,pts[0].v*h);
      for(let i=1;i<pts.length;i++) viewCtx.lineTo(pts[i].u*w,pts[i].v*h);
      if(state.calibrated)viewCtx.closePath();
      viewCtx.strokeStyle=state.calibrated?'rgba(82,215,228,.95)':'rgba(247,198,109,.92)';
      viewCtx.lineWidth=2;viewCtx.setLineDash(state.calibrated?[]:[7,5]);viewCtx.stroke();viewCtx.setLineDash([]);
      if(state.calibrated){viewCtx.fillStyle='rgba(82,215,228,.07)';viewCtx.fill();}
    }
    pts.forEach((p,index)=>{
      const x=p.u*w,y=p.v*h;
      viewCtx.beginPath();viewCtx.arc(x,y,13,0,Math.PI*2);viewCtx.fillStyle='rgba(7,18,28,.82)';viewCtx.fill();
      viewCtx.strokeStyle=state.calibrated?'#52d7e4':'#f7c66d';viewCtx.lineWidth=2;viewCtx.stroke();
      viewCtx.fillStyle='#f2f8fc';viewCtx.font='700 11px Inter,system-ui,sans-serif';viewCtx.textAlign='center';viewCtx.textBaseline='middle';viewCtx.fillText(cornerShort[index],x,y);
    });
    if(state.targetPoint) {
      const x=state.targetPoint.u*w,y=state.targetPoint.v*h;
      viewCtx.beginPath();viewCtx.arc(x,y,15,0,Math.PI*2);viewCtx.strokeStyle='#ff6d72';viewCtx.lineWidth=2;viewCtx.stroke();
      viewCtx.beginPath();viewCtx.moveTo(x-21,y);viewCtx.lineTo(x+21,y);viewCtx.moveTo(x,y-21);viewCtx.lineTo(x,y+21);viewCtx.strokeStyle='rgba(255,255,255,.9)';viewCtx.lineWidth=1;viewCtx.stroke();
      if(state.coordinate){
        const label=`X ${state.coordinate.x.toFixed(1)} cm · Z ${state.coordinate.z.toFixed(1)} cm`;
        viewCtx.font='600 11px Inter,system-ui,sans-serif';const tw=viewCtx.measureText(label).width;
        const bx=Math.max(8,Math.min(w-tw-24,x+21)),by=Math.max(8,Math.min(h-32,y-12));
        roundedRect(viewCtx,bx,by,tw+16,24,7);viewCtx.fillStyle='rgba(6,15,24,.88)';viewCtx.fill();
        viewCtx.fillStyle='#e8f3f8';viewCtx.textAlign='left';viewCtx.textBaseline='middle';viewCtx.fillText(label,bx+8,by+12);
      }
    }
  }

  function roundedRect(ctx,x,y,w,h,r) {
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
  }

  function updateAllAndPersist() { persistState(); updateAll(); }

  function toast(message,type='') {
    const item=document.createElement('div');item.className=`toast ${type}`;item.textContent=message;
    $('toast-region').appendChild(item);
    setTimeout(()=>{item.style.opacity='0';item.style.transform='translateY(5px)';setTimeout(()=>item.remove(),180);},3600);
  }

  function clamp(n,min,max) { return Math.min(max,Math.max(min,n)); }
})();
