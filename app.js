// ====== CONFIG / SESSION ======
// 👉 วาง Google Apps Script Web App URL ของคุณตรงนี้ (ระหว่างเครื่องหมายคำพูด)
// เมื่อใส่แล้ว ทุกเครื่อง/ทุกเบราว์เซอร์ที่เปิดเว็บนี้จะเชื่อมต่อ Google Sheet ให้อัตโนมัติ ไม่ต้องกรอก URL เอง
const DEFAULT_SCRIPT_URL = "";

let SCRIPT_URL = localStorage.getItem('glucolog_script_url') || DEFAULT_SCRIPT_URL;
let currentUser = JSON.parse(localStorage.getItem('glucolog_user') || 'null');
let html5QrCode = null;
let pendingProduct = null; // ผลิตภัณฑ์ที่กำลังจะบันทึกการกิน

// WHO free-sugar reference (สำหรับผู้ใหญ่ ~2000 kcal/วัน)
const WHO_IDEAL_G = 25;   // <5% ของพลังงาน = ยิ่งดี
const WHO_MAX_G = 50;     // <10% ของพลังงาน = เพดานสูงสุด

// ====== UTIL ======
function toast(msg, isError=false){
  const t = document.getElementById('toast');
  t.textContent = isError ? ('⚠ ' + msg) : msg;
  t.style.background = '#111111';
  t.style.border = isError ? '2px solid #FFFFFF' : 'none';
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2600);
}

function nowLocalDatetime(){
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,16);
}

function fmtDate(iso){
  const d = new Date(iso);
  return d.toLocaleString('th-TH', {day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit'});
}

function isToday(iso){
  const d = new Date(iso), n = new Date();
  return d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth() && d.getDate()===n.getDate();
}

async function sha256(text){
  const enc = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function apiCall(action, method='GET', payload=null, extraParams={}){
  if(!SCRIPT_URL){
    toast('กรุณาตั้งค่า Google Apps Script URL ก่อน', true);
    throw new Error('no script url');
  }
  if(method === 'GET'){
    const params = new URLSearchParams({ action, ...extraParams });
    const res = await fetch(`${SCRIPT_URL}?${params.toString()}`);
    return res.json();
  } else {
    const res = await fetch(SCRIPT_URL, { method:'POST', body: JSON.stringify({ action, ...payload }) });
    return res.json();
  }
}

// ====== AUTH SCREEN ======
document.querySelectorAll('.auth-tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.auth-tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.authtab + 'Form').classList.add('active');
  });
});

document.getElementById('authScriptUrl').value = SCRIPT_URL;
if(DEFAULT_SCRIPT_URL){
  // มี URL ฝังในโค้ดแล้ว ไม่ต้องให้ผู้ใช้กรอกเอง ซ่อนช่องนี้ไว้
  document.getElementById('authScriptUrl').closest('.row-input').style.display = 'none';
}
document.getElementById('authSaveUrlBtn').addEventListener('click', ()=>{
  const url = document.getElementById('authScriptUrl').value.trim();
  if(!url){ toast('กรุณากรอก URL', true); return; }
  SCRIPT_URL = url;
  localStorage.setItem('glucolog_script_url', url);
  toast('บันทึก URL แล้ว');
});

document.getElementById('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  try{
    const passwordHash = await sha256(password);
    const res = await apiCall('login', 'POST', { username, passwordHash });
    if(res.error){ toast(res.error, true); return; }
    currentUser = res.user;
    localStorage.setItem('glucolog_user', JSON.stringify(currentUser));
    toast(`ยินดีต้อนรับ ${currentUser.displayName} 👋`);
    showApp();
  }catch(err){ console.error(err); toast('เข้าสู่ระบบไม่สำเร็จ ตรวจสอบ Script URL', true); }
});

document.getElementById('registerForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const displayName = document.getElementById('regDisplayName').value.trim() || username;
  const weight = Number(document.getElementById('regWeight').value);
  const userType = document.getElementById('regUserType').value;
  try{
    const passwordHash = await sha256(password);
    const res = await apiCall('register', 'POST', { username, passwordHash, displayName, weight, userType });
    if(res.error){ toast(res.error, true); return; }
    currentUser = res.user;
    localStorage.setItem('glucolog_user', JSON.stringify(currentUser));
    toast(`สมัครสำเร็จ ยินดีต้อนรับ ${currentUser.displayName} 👋${currentUser.role==='admin' ? ' (สิทธิ์แอดมิน)' : ''}`);
    showApp();
  }catch(err){ console.error(err); toast('สมัครไม่สำเร็จ ตรวจสอบ Script URL', true); }
});

document.getElementById('logoutBtn').addEventListener('click', ()=>{
  localStorage.removeItem('glucolog_user');
  currentUser = null;
  document.getElementById('appScreen').classList.remove('active');
  document.getElementById('authScreen').style.display = 'flex';
});

function showApp(){
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').classList.add('active');
  document.getElementById('userChip').textContent = `${currentUser.displayName} · ${currentUser.role === 'admin' ? 'แอดมิน' : 'สมาชิก'}`;
  document.querySelectorAll('.admin-only').forEach(el=> el.style.display = currentUser.role === 'admin' ? '' : 'none');
  document.getElementById('sugarUserType').value = currentUser.userType || 'ทั่วไป';
  document.getElementById('exWeight').value = currentUser.weight || 65;
  document.getElementById('profileDisplayName').value = currentUser.displayName || '';
  document.getElementById('profileWeight').value = currentUser.weight || '';
  document.getElementById('profileUserType').value = currentUser.userType || 'ทั่วไป';
  document.getElementById('scriptUrl').value = SCRIPT_URL;
  loadAll().then(()=> openDashboardTab());
}

// ====== TABS ======
document.getElementById('tabs').addEventListener('click', (e)=>{
  const btn = e.target.closest('.tab');
  if(!btn) return;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
  if(btn.dataset.tab === 'stats') renderStats();
  if(btn.dataset.tab === 'admin') loadAdmin();
  if(btn.dataset.tab === 'dashboard') openDashboardTab();
});

// ====== SUGAR ======
let sugarData = [], exerciseData = [], foodData = [];

document.getElementById('sugarDate').value = nowLocalDatetime();
document.getElementById('sugarForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const entry = {
    userId: currentUser.id,
    date: document.getElementById('sugarDate').value,
    value: Number(document.getElementById('sugarValue').value),
    context: document.getElementById('sugarContext').value,
    userType: document.getElementById('sugarUserType').value,
    note: document.getElementById('sugarNote').value
  };
  try{
    await apiCall('addSugar', 'POST', entry);
    toast('บันทึกค่าน้ำตาลเรียบร้อย ✅');
    e.target.reset();
    document.getElementById('sugarDate').value = nowLocalDatetime();
    document.getElementById('sugarUserType').value = currentUser.userType || 'ทั่วไป';
    loadSugarData();
  }catch(err){ console.error(err); }
});

function renderSugarTable(){
  const tbody = document.querySelector('#sugarTable tbody');
  tbody.innerHTML = '';
  sugarData.slice().reverse().slice(0,50).forEach(row=>{
    const alertStyle = row.value > 180 || row.value < 70 ? ' style="color:#111111;font-weight:700;"' : '';
    tbody.innerHTML += `<tr>
      <td>${fmtDate(row.date)}</td>
      <td${alertStyle}>${row.value}</td>
      <td class="text-cell">${row.context||''}</td>
      <td class="text-cell">${row.userType||''}</td>
      <td class="text-cell">${row.note||''}</td>
    </tr>`;
  });
}

async function loadSugarData(){
  try{
    const res = await apiCall('listSugar', 'GET', null, { userId: currentUser.id, requesterId: currentUser.id });
    sugarData = res.data || [];
    renderSugarTable();
  }catch(err){ console.error(err); }
}

// ====== EXERCISE (add / edit / delete) ======
document.getElementById('exDate').value = nowLocalDatetime();

function calcBurn(){
  const met = Number(document.querySelector('#exType option:checked').dataset.met);
  const duration = Number(document.getElementById('exDuration').value);
  const weight = Number(document.getElementById('exWeight').value);
  const preview = document.getElementById('calcPreview');
  if(!duration || !weight){
    preview.textContent = 'กรอกข้อมูลเพื่อดูค่าประมาณการเผาผลาญ';
    return null;
  }
  const calories = met * weight * (duration/60);
  const sugarGrams = calories / 4;
  preview.innerHTML = `≈ <b>${calories.toFixed(0)} kcal</b> · เทียบเท่าน้ำตาล/คาร์บที่เผาผลาญ ≈ <b>${sugarGrams.toFixed(1)} กรัม</b><br><span style="font-size:11px;opacity:.8">*ค่าประมาณจากสูตร MET มาตรฐาน ไม่ใช่การวัดทางการแพทย์ที่แม่นยำ</span>`;
  return {calories, sugarGrams};
}
['exType','exDuration','exWeight'].forEach(id=>{
  document.getElementById(id).addEventListener('input', calcBurn);
  document.getElementById(id).addEventListener('change', calcBurn);
});

document.getElementById('exerciseForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const result = calcBurn();
  if(!result){ toast('กรุณากรอกระยะเวลาและน้ำหนักตัวให้ครบ', true); return; }
  const editId = document.getElementById('exEditId').value;
  const entry = {
    userId: currentUser.id,
    date: document.getElementById('exDate').value,
    type: document.querySelector('#exType option:checked').value,
    duration: Number(document.getElementById('exDuration').value),
    weight: Number(document.getElementById('exWeight').value),
    calories: Math.round(result.calories),
    sugarGrams: Number(result.sugarGrams.toFixed(1))
  };
  try{
    if(editId){
      await apiCall('updateExercise', 'POST', { id: editId, ...entry });
      toast('แก้ไขข้อมูลเรียบร้อย ✅');
      resetExerciseForm();
    } else {
      await apiCall('addExercise', 'POST', entry);
      toast('บันทึกการออกกำลังกายเรียบร้อย ✅');
      e.target.reset();
      document.getElementById('exDate').value = nowLocalDatetime();
      document.getElementById('exWeight').value = currentUser.weight || 65;
      document.getElementById('calcPreview').textContent = 'กรอกข้อมูลเพื่อดูค่าประมาณการเผาผลาญ';
    }
    loadExerciseData();
  }catch(err){ console.error(err); }
});

function resetExerciseForm(){
  document.getElementById('exEditId').value = '';
  document.getElementById('exFormTitle').textContent = 'บันทึกการออกกำลังกาย';
  document.getElementById('exSubmitBtn').textContent = 'บันทึกการออกกำลังกาย';
  document.getElementById('exCancelEditBtn').style.display = 'none';
  document.getElementById('exerciseForm').reset();
  document.getElementById('exDate').value = nowLocalDatetime();
  document.getElementById('exWeight').value = currentUser.weight || 65;
  document.getElementById('calcPreview').textContent = 'กรอกข้อมูลเพื่อดูค่าประมาณการเผาผลาญ';
}
document.getElementById('exCancelEditBtn').addEventListener('click', resetExerciseForm);

function editExercise(id){
  const row = exerciseData.find(r=>r.id===id);
  if(!row) return;
  document.getElementById('exEditId').value = id;
  document.getElementById('exDate').value = row.date.length>16 ? row.date.slice(0,16) : row.date;
  document.getElementById('exType').value = row.type;
  document.getElementById('exDuration').value = row.duration;
  document.getElementById('exWeight').value = row.weight;
  document.getElementById('exFormTitle').textContent = 'แก้ไขการออกกำลังกาย';
  document.getElementById('exSubmitBtn').textContent = 'บันทึกการแก้ไข';
  document.getElementById('exCancelEditBtn').style.display = 'inline-block';
  calcBurn();
  document.getElementById('panel-exercise').scrollIntoView({behavior:'smooth'});
}

async function deleteExercise(id){
  if(!confirm('ลบรายการนี้ใช่หรือไม่?')) return;
  try{
    await apiCall('deleteExercise', 'POST', { id });
    toast('ลบรายการแล้ว');
    loadExerciseData();
  }catch(err){ console.error(err); }
}

function renderExTable(){
  const tbody = document.querySelector('#exTable tbody');
  tbody.innerHTML = '';
  exerciseData.slice().reverse().slice(0,50).forEach(row=>{
    tbody.innerHTML += `<tr>
      <td>${fmtDate(row.date)}</td>
      <td class="text-cell">${row.type}</td>
      <td>${row.duration}</td>
      <td>${row.calories}</td>
      <td>${row.sugarGrams}</td>
      <td>
        <button class="icon-btn" onclick="editExercise('${row.id}')" title="แก้ไข">✏️</button>
        <button class="icon-btn danger" onclick="deleteExercise('${row.id}')" title="ลบ">🗑️</button>
      </td>
    </tr>`;
  });
}

async function loadExerciseData(){
  try{
    const res = await apiCall('listExercise', 'GET', null, { userId: currentUser.id, requesterId: currentUser.id });
    exerciseData = res.data || [];
    renderExTable();
  }catch(err){ console.error(err); }
}

// ====== FOOD / BARCODE ======
document.getElementById('startScanBtn').addEventListener('click', ()=>{
  document.getElementById('scannerBox').style.display = 'block';
  html5QrCode = new Html5Qrcode("qrReader");
  const formats = window.Html5QrcodeSupportedFormats ? [
    Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E
  ] : undefined;
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 240, formatsToSupport: formats },
    (decodedText)=>{
      stopScanner();
      document.getElementById('manualBarcode').value = decodedText;
      lookupBarcode(decodedText);
    },
    ()=>{}
  ).catch(err=>{
    toast('เปิดกล้องไม่สำเร็จ: ' + err, true);
    document.getElementById('scannerBox').style.display = 'none';
  });
});

function stopScanner(){
  if(html5QrCode){
    html5QrCode.stop().then(()=>html5QrCode.clear()).catch(()=>{});
  }
  document.getElementById('scannerBox').style.display = 'none';
}
document.getElementById('stopScanBtn').addEventListener('click', stopScanner);

document.getElementById('lookupBarcodeBtn').addEventListener('click', ()=>{
  const code = document.getElementById('manualBarcode').value.trim();
  if(!code){ toast('กรุณากรอกเลขบาร์โค้ด', true); return; }
  lookupBarcode(code);
});

async function lookupBarcode(barcode){
  document.getElementById('productResultCard').style.display = 'none';
  document.getElementById('notFoundCard').style.display = 'none';
  toast('กำลังค้นหา…');
  // 1) ค้นในฐานข้อมูลของเราก่อน (สินค้าที่เคยเพิ่มเอง)
  try{
    const local = await apiCall('findProduct', 'GET', null, { barcode });
    if(local.product){
      showProductResult(local.product.name, Number(local.product.sugarPer100g), barcode, 'local');
      return;
    }
  }catch(err){ console.error(err); }

  // 2) ค้นจาก Open Food Facts
  try{
    const res = await fetch(`https://th.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const data = await res.json();
    if(data.status === 1 && data.product){
      const name = data.product.product_name || data.product.product_name_th || `สินค้าบาร์โค้ด ${barcode}`;
      const sugar = data.product.nutriments && (data.product.nutriments.sugars_100g ?? data.product.nutriments.carbohydrates_100g);
      if(sugar !== undefined && sugar !== null){
        showProductResult(name, Number(sugar), barcode, 'openfoodfacts');
        // เก็บลงฐานข้อมูลตัวเองด้วยเพื่อค้นเร็วขึ้นครั้งหน้า
        apiCall('addProduct', 'POST', { name, barcode, sugarPer100g: Number(sugar), addedBy: currentUser.id, source:'openfoodfacts' }).catch(()=>{});
        return;
      }
    }
  }catch(err){ console.error(err); }

  // 3) ไม่พบ -> ให้เพิ่มเอง
  document.getElementById('notFoundCard').style.display = 'block';
  document.getElementById('newProductName').value = '';
  document.getElementById('addProductForm').dataset.barcode = barcode;
}

function showProductResult(name, sugarPer100g, barcode, source){
  pendingProduct = { name, sugarPer100g, barcode, source };
  document.getElementById('productResultCard').style.display = 'block';
  document.getElementById('productName').textContent = name;
  document.getElementById('productSugarInfo').textContent = `น้ำตาล ${sugarPer100g} กรัม ต่อ 100 กรัม`;
  document.getElementById('gramsConsumed').value = '';
  document.getElementById('foodCalcPreview').textContent = '';
}

document.getElementById('gramsConsumed').addEventListener('input', ()=>{
  if(!pendingProduct) return;
  const grams = Number(document.getElementById('gramsConsumed').value);
  const preview = document.getElementById('foodCalcPreview');
  if(!grams){ preview.textContent = ''; return; }
  const sugarConsumed = (pendingProduct.sugarPer100g / 100) * grams;
  const weight = currentUser.weight || 65;
  const walkMin = ((sugarConsumed*4) / (4.3*weight/60)).toFixed(0);
  const jogMin = ((sugarConsumed*4) / (7.0*weight/60)).toFixed(0);
  preview.innerHTML = `น้ำตาลที่ได้รับ ≈ <b>${sugarConsumed.toFixed(1)} กรัม</b><br>ต้องเผาผลาญ ≈ เดินเร็ว <b>${walkMin} นาที</b> หรือ วิ่งเหยาะ <b>${jogMin} นาที</b>`;
});

document.getElementById('logFoodBtn').addEventListener('click', async ()=>{
  const grams = Number(document.getElementById('gramsConsumed').value);
  if(!grams || !pendingProduct){ toast('กรุณากรอกปริมาณที่กิน', true); return; }
  const sugarConsumed = Number(((pendingProduct.sugarPer100g/100)*grams).toFixed(1));
  try{
    await apiCall('addFoodLog', 'POST', {
      userId: currentUser.id, date: new Date().toISOString(),
      productName: pendingProduct.name, barcode: pendingProduct.barcode,
      gramsConsumed: grams, sugarPer100g: pendingProduct.sugarPer100g,
      sugarConsumed, source: pendingProduct.source
    });
    toast('บันทึกการกินเรียบร้อย ✅');
    document.getElementById('productResultCard').style.display = 'none';
    pendingProduct = null;
    loadFoodData();
  }catch(err){ console.error(err); }
});

document.getElementById('addProductForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const barcode = e.target.dataset.barcode || '';
  const name = document.getElementById('newProductName').value.trim();
  const sugarPer100g = Number(document.getElementById('newProductSugar').value);
  try{
    const res = await apiCall('addProduct', 'POST', { name, barcode, sugarPer100g, addedBy: currentUser.id, source:'manual' });
    toast('เพิ่มสินค้าใหม่แล้ว ✅');
    document.getElementById('notFoundCard').style.display = 'none';
    showProductResult(name, sugarPer100g, barcode, 'manual');
  }catch(err){ console.error(err); }
});

function renderFoodTable(){
  const tbody = document.querySelector('#foodTable tbody');
  tbody.innerHTML = '';
  foodData.slice().reverse().slice(0,50).forEach(row=>{
    tbody.innerHTML += `<tr>
      <td>${fmtDate(row.date)}</td>
      <td class="text-cell">${row.productName}</td>
      <td>${row.gramsConsumed}</td>
      <td>${row.sugarConsumed}</td>
    </tr>`;
  });
  renderWhoCompare();
}

function renderWhoCompare(){
  renderWhoCompareGeneric(foodData, currentUser.userType, currentUser.weight, 'whoCompare');
}

function renderWhoCompareGeneric(foodArr, userType, weight, containerId){
  const el = document.getElementById(containerId);
  if(!el) return;
  const today = foodArr.filter(r=>isToday(r.date));
  const totalSugar = today.reduce((s,r)=>s+Number(r.sugarConsumed||0), 0);
  const isDiabetic = userType === 'เบาหวาน';
  const target = WHO_IDEAL_G; // ใช้เกณฑ์เข้มงวด (5%) เป็นเป้าหมายอ้างอิงสำหรับทั้งสองกลุ่ม
  const pct = Math.min(100, (totalSugar/target)*100);
  const over = totalSugar > target;
  const excess = Math.max(0, totalSugar - target);
  const w = weight || 65;
  const walkMin = excess ? ((excess*4)/(4.3*w/60)).toFixed(0) : 0;

  el.innerHTML = `
    <div class="who-row">
      <span>วันนี้กินน้ำตาลไปแล้ว</span>
      <span><b>${totalSugar.toFixed(1)} g</b> / เป้าหมาย ${target} g</span>
    </div>
    <div class="who-bar-track"><div class="who-bar-fill ${over?'over':''}" style="width:${pct}%"></div></div>
    <div class="who-row" style="margin-top:10px;">
      <span>เพดานสูงสุดตาม WHO (10% ของพลังงาน)</span><span>${WHO_MAX_G} g/วัน</span>
    </div>
    ${over ? `<div class="who-row"><span>เกินเป้าหมาย ต้องเผาผลาญเพิ่ม</span><span><b>≈ เดินเร็ว ${walkMin} นาที</b></span></div>` : ''}
    <p class="who-disclaimer">
      *อ้างอิงคำแนะนำองค์การอนามัยโลก (WHO): จำกัดน้ำตาลฟรีไม่เกิน 10% ของพลังงานทั้งวัน และควรต่ำกว่า 5% (~25g สำหรับผู้ใหญ่ทั่วไปที่ 2000 kcal/วัน) เพื่อประโยชน์ต่อสุขภาพเพิ่มเติม
      ${isDiabetic ? 'สำหรับผู้ป่วยเบาหวาน ควรเข้มงวดกว่านี้และปรึกษาแพทย์/นักโภชนาการเพื่อกำหนดเป้าหมายเฉพาะบุคคล เนื่องจากขึ้นอยู่กับยา ระดับกิจกรรม และภาวะสุขภาพของแต่ละคน' : ''}
      ตัวเลขนี้เป็นข้อมูลอ้างอิงทั่วไป ไม่ใช่คำวินิจฉัยทางการแพทย์
    </p>`;
}

async function loadFoodData(){
  try{
    const res = await apiCall('listFoodLog', 'GET', null, { userId: currentUser.id, requesterId: currentUser.id });
    foodData = res.data || [];
    renderFoodTable();
  }catch(err){ console.error(err); }
}

// ====== STATS ======
function renderStats(){
  const sevenDaysAgo = Date.now() - 7*24*60*60*1000;
  const recentSugar = sugarData.filter(r=> new Date(r.date).getTime() >= sevenDaysAgo);
  const recentEx = exerciseData.filter(r=> new Date(r.date).getTime() >= sevenDaysAgo);
  const recentFood = foodData.filter(r=> new Date(r.date).getTime() >= sevenDaysAgo);

  const avgSugar = recentSugar.length ? (recentSugar.reduce((s,r)=>s+Number(r.value),0)/recentSugar.length) : 0;
  const totalCal = recentEx.reduce((s,r)=>s+Number(r.calories),0);
  const totalFoodSugar = recentFood.reduce((s,r)=>s+Number(r.sugarConsumed),0);

  document.getElementById('statAvgSugar').textContent = avgSugar ? avgSugar.toFixed(0)+' mg/dL' : '–';
  document.getElementById('statTotalCal').textContent = totalCal ? totalCal.toFixed(0)+' kcal' : '–';
  document.getElementById('statFoodSugar').textContent = totalFoodSugar ? totalFoodSugar.toFixed(1)+' g' : '–';
  document.getElementById('statExCount').textContent = recentEx.length;

  drawLineChart('sugarChart', recentSugar.map(r=>({x:r.date, y:Number(r.value)})), '#111111', 'mg/dL');
  drawBarChart('calChart', recentEx.map(r=>({x:r.date, y:Number(r.calories)})), '#555555', 'kcal');
}

function drawLineChart(canvasId, points, color, unit){
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.clientWidth; canvas.height = 220;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(points.length < 2){
    ctx.fillStyle = '#6E6E6E'; ctx.font='13px Inter';
    ctx.fillText('ยังไม่มีข้อมูลเพียงพอสำหรับแสดงกราฟ', 12, 110);
    return;
  }
  points.sort((a,b)=> new Date(a.x)-new Date(b.x));
  const pad = 30;
  const ys = points.map(p=>p.y);
  const minY = Math.min(...ys)*0.9, maxY = Math.max(...ys)*1.1;
  const w = canvas.width - pad*2, h = canvas.height - pad*2;
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
  points.forEach((p,i)=>{
    const x = pad + (i/(points.length-1))*w;
    const y = pad + h - ((p.y-minY)/(maxY-minY))*h;
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  });
  ctx.stroke();
  points.forEach((p,i)=>{
    const x = pad + (i/(points.length-1))*w;
    const y = pad + h - ((p.y-minY)/(maxY-minY))*h;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x,y,3,0,7); ctx.fill();
  });
  ctx.fillStyle = '#6E6E6E'; ctx.font = '11px JetBrains Mono';
  ctx.fillText(maxY.toFixed(0)+' '+unit, 2, pad);
  ctx.fillText(minY.toFixed(0)+' '+unit, 2, pad+h);
}

function drawBarChart(canvasId, points, color, unit){
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.clientWidth; canvas.height = 220;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(points.length < 1){
    ctx.fillStyle = '#6E6E6E'; ctx.font='13px Inter';
    ctx.fillText('ยังไม่มีข้อมูลเพียงพอสำหรับแสดงกราฟ', 12, 110);
    return;
  }
  const pad = 30;
  const w = canvas.width - pad*2, h = canvas.height - pad*2;
  const maxY = Math.max(...points.map(p=>p.y)) * 1.15 || 1;
  const barW = w/points.length * 0.6;
  points.forEach((p,i)=>{
    const x = pad + (i/points.length)*w + (w/points.length - barW)/2;
    const barH = (p.y/maxY)*h;
    ctx.fillStyle = color;
    ctx.fillRect(x, pad+h-barH, barW, barH);
  });
  ctx.fillStyle = '#6E6E6E'; ctx.font = '11px JetBrains Mono';
  ctx.fillText(maxY.toFixed(0)+' '+unit, 2, pad);
}

// ====== ADMIN ======
async function loadAdmin(){
  if(currentUser.role !== 'admin') return;
  try{
    const res = await apiCall('listUsers', 'GET', null, { requesterId: currentUser.id });
    const users = res.data || [];
    const tbody = document.querySelector('#adminUserTable tbody');
    tbody.innerHTML = '';
    users.forEach(u=>{
      tbody.innerHTML += `<tr>
        <td class="text-cell">${u.username}</td>
        <td class="text-cell">${u.displayName}</td>
        <td class="text-cell">${u.role}</td>
        <td class="text-cell">${u.userType}</td>
        <td>${u.createdAt ? fmtDate(u.createdAt) : ''}</td>
        <td>${u.id === currentUser.id ? '' : `<button class="icon-btn" onclick="toggleRole('${u.id}','${u.role}')">${u.role==='admin'?'ถอดสิทธิ์':'ตั้งเป็นแอดมิน'}</button>`}</td>
      </tr>`;
    });

    const [allSugar, allEx] = await Promise.all([
      apiCall('listSugar', 'GET', null, { userId:'all', requesterId: currentUser.id }),
      apiCall('listExercise', 'GET', null, { userId:'all', requesterId: currentUser.id })
    ]);
    const sevenDaysAgo = Date.now() - 7*24*60*60*1000;
    document.getElementById('adminSugarCount').textContent = (allSugar.data||[]).filter(r=>new Date(r.date).getTime()>=sevenDaysAgo).length;
    document.getElementById('adminExCount').textContent = (allEx.data||[]).filter(r=>new Date(r.date).getTime()>=sevenDaysAgo).length;
  }catch(err){ console.error(err); }
}

async function toggleRole(userId, currentRole){
  const newRole = currentRole === 'admin' ? 'user' : 'admin';
  try{
    await apiCall('setRole', 'POST', { requesterId: currentUser.id, targetUserId: userId, role: newRole });
    toast('อัปเดตสิทธิ์แล้ว');
    loadAdmin();
  }catch(err){ console.error(err); }
}

// ====== DASHBOARD ======
let dashboardUsersCache = null; // {id: {displayName, weight, userType, username}}
let dashboardTargetId = null;

async function openDashboardTab(){
  if(currentUser.role === 'admin'){
    document.getElementById('dashboardUserPicker').style.display = '';
    if(!dashboardUsersCache) await loadDashboardUserList();
  }
  loadDashboard(dashboardTargetId || currentUser.id);
}

async function loadDashboardUserList(){
  try{
    const res = await apiCall('listUsers', 'GET', null, { requesterId: currentUser.id });
    const users = res.data || [];
    dashboardUsersCache = {};
    users.forEach(u=> dashboardUsersCache[u.id] = u);
    const select = document.getElementById('dashboardUserSelect');
    select.innerHTML = users.map(u=>
      `<option value="${u.id}" ${u.id===currentUser.id?'selected':''}>${u.displayName}${u.id===currentUser.id?' (ฉัน)':''}</option>`
    ).join('');
  }catch(err){ console.error(err); }
}

document.getElementById('dashboardUserSelect').addEventListener('change', (e)=>{
  dashboardTargetId = e.target.value;
  loadDashboard(dashboardTargetId);
});

async function loadDashboard(targetUserId){
  let sugarArr, exerciseArr, foodArr, weight, userType;
  if(targetUserId === currentUser.id){
    sugarArr = sugarData; exerciseArr = exerciseData; foodArr = foodData;
    weight = currentUser.weight; userType = currentUser.userType;
  } else {
    try{
      const [s, ex, fd] = await Promise.all([
        apiCall('listSugar', 'GET', null, { userId: targetUserId, requesterId: currentUser.id }),
        apiCall('listExercise', 'GET', null, { userId: targetUserId, requesterId: currentUser.id }),
        apiCall('listFoodLog', 'GET', null, { userId: targetUserId, requesterId: currentUser.id })
      ]);
      sugarArr = s.data || []; exerciseArr = ex.data || []; foodArr = fd.data || [];
      const u = dashboardUsersCache ? dashboardUsersCache[targetUserId] : null;
      weight = u ? u.weight : 65; userType = u ? u.userType : 'ทั่วไป';
    }catch(err){ console.error(err); return; }
  }
  renderDashboard(sugarArr, exerciseArr, foodArr, weight, userType);
}

function renderDashboard(sugarArr, exerciseArr, foodArr, weight, userType){
  const sevenDaysAgo = Date.now() - 7*24*60*60*1000;
  const recentSugar = sugarArr.filter(r=> new Date(r.date).getTime() >= sevenDaysAgo);
  const recentEx = exerciseArr.filter(r=> new Date(r.date).getTime() >= sevenDaysAgo);
  const todayFood = foodArr.filter(r=> isToday(r.date));

  const sorted = sugarArr.slice().sort((a,b)=> new Date(b.date)-new Date(a.date));
  const latest = sorted[0];
  const avgSugar = recentSugar.length ? (recentSugar.reduce((s,r)=>s+Number(r.value),0)/recentSugar.length) : 0;
  const foodTodaySum = todayFood.reduce((s,r)=>s+Number(r.sugarConsumed||0),0);

  document.getElementById('dashLatestSugar').textContent = latest ? `${latest.value} mg/dL` : '–';
  document.getElementById('dashAvgSugar').textContent = avgSugar ? avgSugar.toFixed(0)+' mg/dL' : '–';
  document.getElementById('dashFoodToday').textContent = foodTodaySum ? foodTodaySum.toFixed(1)+' g' : '–';
  document.getElementById('dashExCount').textContent = recentEx.length;

  drawLineChart('dashSugarChart', recentSugar.map(r=>({x:r.date, y:Number(r.value)})), '#111111', 'mg/dL');
  renderWhoCompareGeneric(foodArr, userType, weight, 'dashWhoCompare');

  const merged = [
    ...sugarArr.map(r=>({date:r.date, label:`น้ำตาล ${r.value} mg/dL · ${r.context||''}`})),
    ...exerciseArr.map(r=>({date:r.date, label:`ออกกำลังกาย ${r.type} ${r.duration} นาที`})),
    ...foodArr.map(r=>({date:r.date, label:`กิน ${r.productName} · น้ำตาล ${r.sugarConsumed} g`}))
  ].sort((a,b)=> new Date(b.date)-new Date(a.date)).slice(0,6);

  document.getElementById('dashRecent').innerHTML = merged.length
    ? merged.map(m=>`<div class="who-row"><span>${fmtDate(m.date)}</span><span class="text-cell">${m.label}</span></div>`).join('')
    : '<p class="hint">ยังไม่มีข้อมูล</p>';
}

// ====== SETTINGS / PROFILE ======
document.getElementById('profileForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const displayName = document.getElementById('profileDisplayName').value.trim();
  const weight = Number(document.getElementById('profileWeight').value);
  const userType = document.getElementById('profileUserType').value;
  try{
    await apiCall('updateProfile', 'POST', { userId: currentUser.id, displayName, weight, userType });
    currentUser = { ...currentUser, displayName, weight, userType };
    localStorage.setItem('glucolog_user', JSON.stringify(currentUser));
    document.getElementById('userChip').textContent = `${currentUser.displayName} · ${currentUser.role === 'admin' ? 'แอดมิน' : 'สมาชิก'}`;
    toast('บันทึกโปรไฟล์แล้ว ✅');
  }catch(err){ console.error(err); }
});

document.getElementById('saveUrlBtn').addEventListener('click', ()=>{
  const url = document.getElementById('scriptUrl').value.trim();
  if(!url){ toast('กรุณากรอก URL', true); return; }
  SCRIPT_URL = url;
  localStorage.setItem('glucolog_script_url', url);
  toast('บันทึก URL แล้ว กำลังโหลดข้อมูล…');
  loadAll();
});

document.getElementById('openSheetBtn').addEventListener('click', async ()=>{
  try{
    const res = await apiCall('sheetUrl');
    if(res.url) window.open(res.url, '_blank');
    else toast('ไม่พบลิงก์ Google Sheet', true);
  }catch(err){}
});

document.getElementById('exportExcelBtn').addEventListener('click', ()=>{
  if(!sugarData.length && !exerciseData.length && !foodData.length){
    toast('ยังไม่มีข้อมูลให้ export', true); return;
  }
  const wb = XLSX.utils.book_new();
  const wsSugar = XLSX.utils.json_to_sheet(sugarData.map(r=>({
    'วันที่': fmtDate(r.date), 'ค่าน้ำตาล(mg/dL)': r.value, 'ช่วงเวลา': r.context, 'ประเภทผู้ใช้': r.userType, 'หมายเหตุ': r.note
  })));
  const wsEx = XLSX.utils.json_to_sheet(exerciseData.map(r=>({
    'วันที่': fmtDate(r.date), 'กิจกรรม': r.type, 'นาที': r.duration, 'น้ำหนัก(กก.)': r.weight, 'แคลอรี่': r.calories, 'น้ำตาลที่เผาผลาญ(กรัม)': r.sugarGrams
  })));
  const wsFood = XLSX.utils.json_to_sheet(foodData.map(r=>({
    'วันที่': fmtDate(r.date), 'รายการ': r.productName, 'กรัมที่กิน': r.gramsConsumed, 'น้ำตาล/100g': r.sugarPer100g, 'น้ำตาลที่ได้รับ(กรัม)': r.sugarConsumed
  })));
  XLSX.utils.book_append_sheet(wb, wsSugar, 'ค่าน้ำตาล');
  XLSX.utils.book_append_sheet(wb, wsEx, 'ออกกำลังกาย');
  XLSX.utils.book_append_sheet(wb, wsFood, 'การกินอาหาร');
  XLSX.writeFile(wb, `GlucoLog_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Export Excel สำเร็จ 📊');
});

// ====== INIT ======
async function loadAll(){
  await Promise.all([loadSugarData(), loadExerciseData(), loadFoodData()]);
}

if(currentUser && SCRIPT_URL){
  showApp();
} else {
  document.getElementById('authScreen').style.display = 'flex';
}
calcBurn();
