import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  CalendarDays, Clock3, ShieldCheck, ListOrdered, ArrowRight, 
  RefreshCw, CalendarCheck, Users, LogOut, 
  AlertTriangle, Trash2, Search, Download, RotateCcw, Siren, ShieldAlert,
  User, UserCheck, Ticket, Printer, Volume2, XCircle
} from 'lucide-react';
import { SERVICES, OFFICE, STATUS_LABELS } from './config.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const CREATE_URL = import.meta.env.VITE_CREATE_BOOKING_URL;
const SLOTS_URL = import.meta.env.VITE_AVAILABLE_SLOTS_URL;
const STAFF_ACTION_URL = import.meta.env.VITE_STAFF_ACTION_URL;

function kyivDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'long', timeZone: 'Europe/Kyiv' }).format(new Date(`${value}T12:00:00`));
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.6);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.25);
    gain2.gain.setValueAtTime(0.35, now + 0.25);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.25);
    osc2.stop(now + 1.2);
  } catch (e) {
    console.warn('AudioContext requires user interaction first', e);
  }
}

export default function App() {
  const [tab, setTab] = useState('book');
  const [mode, setMode] = useState('scheduled');
  const [visitDate, setVisitDate] = useState(kyivDate());
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [publicQueue, setPublicQueue] = useState([]);
  const [staffQueue, setStaffQueue] = useState([]);
  const [staffDate, setStaffDate] = useState(kyivDate());
  
  // Авторизація та акаунти
  const [session, setSession] = useState(null);
  const [isStaff, setIsStaff] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ identifier: '', password: '', full_name: '', phone: '' });

  // Талони в особистому кабінеті громадянина
  const [userAppointments, setUserAppointments] = useState([]);
  const [calledAlertShown, setCalledAlertShown] = useState(false);

  // Кабінет працівника: пошук, фільтри, профіль
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [staffProfile, setStaffProfile] = useState({ name: 'Очеретяний Ярослав Романович', role: 'Адміністратор системи' });

  // Стан прийому
  const [dayStatus, setDayStatus] = useState({ isWorking: true, reason: '' });
  const [statusReasonInput, setStatusReasonInput] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);

  // Форма без полів Telegram
  const [form, setForm] = useState({ 
    full_name: '', phone: '', service: SERVICES[0], 
    visit_date: kyivDate(), booking_type: 'scheduled', 
    appointment_time: '', notes: '' 
  });
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [staffLoading, setStaffLoading] = useState(false);

  const basePath = import.meta.env.BASE_URL;
  const updateForm = (key, value) => setForm(old => ({ ...old, [key]: value }));

  const invoke = useCallback(async (url, body, token = SUPABASE_KEY) => {
    if (!url) throw new Error('Не налаштовано адресу серверної функції.');
    const response = await fetch(url, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, 
      body: JSON.stringify(body) 
    });
    let payload = {};
    try { payload = await response.json(); } catch { /* ignore */ }
    if (!response.ok) throw new Error(payload.error || 'Помилка серверної функції.');
    return payload;
  }, []);

  const loadDayStatus = useCallback(async (date) => {
    if (!supabase) return;
    const { data } = await supabase.from('system_status').select('is_working, reason').eq('date', date).single();
    if (data) {
      setDayStatus({ isWorking: data.is_working, reason: data.reason || '' });
      setStatusReasonInput(data.reason || '');
    } else {
      setDayStatus({ isWorking: true, reason: '' });
      setStatusReasonInput('');
    }
  }, []);

  const updateDayStatus = async (isWorking, presetReason = null) => {
    const reasonToSave = presetReason !== null ? presetReason : statusReasonInput.trim();
    if (!isWorking && !reasonToSave) {
      setError('Вкажіть причину зупинки роботи.');
      return;
    }
    setError(''); setMessage(''); setStatusLoading(true);
    const { error: dbError } = await supabase.from('system_status').upsert({
      date: staffDate,
      is_working: isWorking,
      reason: isWorking ? null : reasonToSave,
      updated_at: new Date().toISOString()
    }, { onConflict: 'date' });
    
    setStatusLoading(false);
    if (dbError) {
      setError('Помилка оновлення статусу: ' + dbError.message);
    } else {
      setMessage(isWorking ? 'Прийом відновлено.' : 'Прийом призупинено. Червоний банер активовано.');
      loadDayStatus(staffDate);
    }
  };

  const loadSlots = useCallback(async (date) => {
    if (!SLOTS_URL) { setSlots([]); return; }
    setSlotsLoading(true);
    try {
      const result = await invoke(SLOTS_URL, { visit_date: date });
      setSlots(result.slots || []);
      setForm(old => ({ ...old, appointment_time: (result.slots || []).includes(old.appointment_time) ? old.appointment_time : (result.slots || [])[0] || '' }));
    } catch (e) { setSlots([]); setError(e.message); }
    finally { setSlotsLoading(false); }
  }, [invoke]);

  const loadPublicQueue = useCallback(async (date = visitDate) => {
    if (!supabase) return;
    const { data, error: queryError } = await supabase.from('public_queue').select('queue_number,visit_date,status,booking_type,appointment_time,created_at').eq('visit_date', date).order('queue_number', { ascending: true });
    if (queryError) setError(queryError.message); else setPublicQueue(data || []);
  }, [visitDate]);

  const loadStaffQueue = useCallback(async (date = staffDate) => {
    if (!supabase) return;
    setStaffLoading(true);
    const { data, error: queryError } = await supabase.from('appointments').select('id,queue_number,full_name,phone,service,visit_date,booking_type,appointment_time,notes,status,created_at').eq('visit_date', date).order('queue_number', { ascending: true });
    if (queryError) setError(queryError.message); else setStaffQueue(data || []);
    setStaffLoading(false);
  }, [staffDate]);

  const loadUserAppointments = useCallback(async () => {
    if (!supabase || !session?.user?.id) return;
    const userPhone = session.user.user_metadata?.phone;
    let query = supabase.from('appointments').select('*').order('visit_date', { ascending: false }).order('queue_number', { ascending: true });
    
    if (userPhone) {
      query = query.or(`user_id.eq.${session.user.id},phone.eq.${userPhone}`);
    } else {
      query = query.eq('user_id', session.user.id);
    }

    const { data, error: err } = await query;
    if (!err && data) {
      setUserAppointments(data);
      const isServingNow = data.some(item => item.status === 'serving' && item.visit_date === kyivDate());
      if (isServingNow && !calledAlertShown) {
        playChime();
        setCalledAlertShown(true);
      }
    }
  }, [session, calledAlertShown]);

  async function checkStaffRole(userId) {
    if (!supabase) return;
    const { data } = await supabase.from('staff').select('display_name, role').eq('user_id', userId).maybeSingle();
    if (data) {
      setIsStaff(true);
      setStaffProfile({ name: data.display_name, role: data.role || 'Працівник' });
    } else {
      setIsStaff(false);
    }
  }

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) checkStaffRole(data.session.user.id);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, val) => {
      setSession(val);
      if (val?.user) {
        checkStaffRole(val.user.id);
        if (val.user.user_metadata?.full_name) {
          setForm(prev => ({
            ...prev,
            full_name: val.user.user_metadata.full_name || prev.full_name,
            phone: val.user.user_metadata.phone || prev.phone
          }));
        }
      } else {
        setIsStaff(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session && tab === 'user') {
      loadUserAppointments();
      const interval = setInterval(loadUserAppointments, 15000);
      return () => clearInterval(interval);
    }
  }, [session, tab, loadUserAppointments]);

  useEffect(() => { 
    if (mode === 'scheduled') loadSlots(form.visit_date); 
    loadDayStatus(form.visit_date);
  }, [mode, form.visit_date, loadSlots, loadDayStatus]);

  useEffect(() => { 
    loadPublicQueue(); 
    const timer = setInterval(() => loadPublicQueue(), 20000); 
    return () => clearInterval(timer); 
  }, [loadPublicQueue]);

  useEffect(() => { 
    if (session && isStaff && tab === 'staff') {
      loadStaffQueue();
      loadDayStatus(staffDate);
    }
  }, [session, isStaff, tab, staffDate, loadStaffQueue, loadDayStatus]);

  async function handleAuth(e) {
    e.preventDefault();
    setError(''); setMessage('');
    if (!supabase) return;

    let email = authForm.identifier.trim();
    if (!email.includes('@')) {
      const cleanPhone = email.replace(/[^\d+]/g, '');
      email = `${cleanPhone}@queue.local`;
    }

    if (authMode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password: authForm.password
      });
      if (err) setError('Невірний логін або пароль. Перевірте введені дані.');
      else {
        setMessage('Успішний вхід!');
        setTab('user');
      }
    } else {
      if (authForm.full_name.trim().length < 3 || authForm.phone.trim().length < 7) {
        setError('Вкажіть ваше повне ПІБ та коректний номер телефону.');
        return;
      }
      const { data: signUpData, error: err } = await supabase.auth.signUp({
        email,
        password: authForm.password,
        options: {
          data: {
            full_name: authForm.full_name.trim(),
            phone: authForm.phone.trim()
          }
        }
      });
      if (err) setError('Помилка реєстрації: ' + err.message);
      else {
        setMessage('Обліковий запис успішно створено!');
        setSession(signUpData.session);
        setTab('user');
      }
    }
  }

  async function submitBooking(event) {
    event.preventDefault(); setError(''); setMessage(''); setReceipt(null);
    if (!dayStatus.isWorking) return;
    if (form.full_name.trim().length < 3 || form.phone.trim().length < 7) { 
      setError('Вкажіть повне ПІБ та коректний номер телефону.'); 
      return; 
    }
    if (form.booking_type === 'scheduled' && !form.appointment_time) { 
      setError('Оберіть вільний час прийому.'); 
      return; 
    }
    
    setBusy(true);
    try {
      const payload = await invoke(CREATE_URL, { 
        ...form, 
        booking_type: mode, 
        visit_date: form.visit_date, 
        appointment_time: mode === 'scheduled' ? form.appointment_time : null
      }, session?.access_token || SUPABASE_KEY);

      setReceipt(payload);
      setMessage('Талон успішно створено!');
      await loadPublicQueue(form.visit_date);
      if (session) {
        await loadUserAppointments();
      }
      if (mode === 'live') {
        setForm(old => ({ ...old, notes: '' }));
      }
    } catch (e) { 
      setError(e.message || 'Не вдалося створити запис.'); 
    } finally { 
      setBusy(false); 
    }
  }

  async function cancelUserAppointment(id) {
    if (!window.confirm('Ви дійсно бажаєте скасувати цей запис? Слот стане доступним для інших громадян.')) return;
    try {
      const { error: err } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', id);
      if (err) throw err;
      setMessage('Запис скасовано.');
      await loadUserAppointments();
      await loadPublicQueue(visitDate);
    } catch (e) {
      setError('Не вдалося скасувати: ' + e.message);
    }
  }

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setIsStaff(false);
  };

  async function staffAction(id, action) {
    setError(''); setMessage('');
    if (!session?.access_token) return;
    try {
      const result = await invoke(STAFF_ACTION_URL, { id, action }, session.access_token);
      setMessage(result.message || (action === 'restore' ? 'Запис відновлено в чергу.' : 'Статус оновлено.'));
      await Promise.all([loadStaffQueue(staffDate), loadPublicQueue(staffDate)]);
    } catch (e) { setError(e.message); }
  }

  async function deleteAppointment(id) {
    if (!window.confirm('Ви впевнені, що хочете безповоротно видалити цей запис із бази?')) return;
    try {
      const { error: delError } = await supabase.from('appointments').delete().eq('id', id);
      if (delError) throw delError;
      setMessage('Запис успішно видалено.');
      await Promise.all([loadStaffQueue(staffDate), loadPublicQueue(staffDate)]);
    } catch (e) {
      setError('Не вдалося видалити запис: ' + e.message);
    }
  }

  const exportToCSV = () => {
    if (staffQueue.length === 0) {
      alert('Немає записів для експорту на цю дату.');
      return;
    }
    const headers = ['Номер', 'ПІБ', 'Телефон', 'Послуга', 'Формат', 'Час', 'Статус', 'Коментар', 'Дата запису'];
    const rows = staffQueue.map(item => [
      item.queue_number,
      `"${item.full_name || ''}"`,
      `"${item.phone || ''}"`,
      `"${item.service || ''}"`,
      item.booking_type === 'live' ? 'Жива черга' : 'Попередній запис',
      item.appointment_time ? item.appointment_time.slice(0, 5) : '—',
      STATUS_LABELS[item.status] || item.status,
      `"${(item.notes || '').replace(/"/g, '""')}"`,
      new Date(item.created_at).toLocaleString('uk-UA')
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Черга_${staffDate}.csv`;
    link.click();
  };

  const stats = useMemo(() => {
    const total = staffQueue.length;
    const waiting = staffQueue.filter(i => i.status === 'waiting').length;
    const serving = staffQueue.filter(i => i.status === 'serving').length;
    const completed = staffQueue.filter(i => i.status === 'completed').length;
    const cancelled = staffQueue.filter(i => i.status === 'cancelled').length;
    return { total, waiting, serving, completed, cancelled };
  }, [staffQueue]);

  const displayedStaffQueue = useMemo(() => {
    return staffQueue.filter(item => {
      const matchStatus = statusFilter === 'all' || item.status === statusFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchSearch = !q || 
        item.full_name.toLowerCase().includes(q) ||
        item.phone.includes(q) ||
        String(item.queue_number).includes(q) ||
        (item.notes && item.notes.toLowerCase().includes(q));
      return matchStatus && matchSearch;
    });
  }, [staffQueue, statusFilter, searchQuery]);

  const filteredQueue = useMemo(() => publicQueue.filter(item => item.status !== 'cancelled'), [publicQueue]);
  const displayTime = (item) => item.booking_type === 'live' ? 'Жива черга' : (item.appointment_time ? item.appointment_time.slice(0, 5) : 'Час не вказано');

  const isAirAlertActive = !dayStatus.isWorking && dayStatus.reason?.toLowerCase().includes('тривог');
  const activeUserTicket = userAppointments.find(i => ['waiting', 'serving'].includes(i.status));

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <img className="crest" src={`${basePath}gerb-borodianka.png`} alt={`Герб ${OFFICE.subtitle}`} />
          <div><span className="overline">{OFFICE.subtitle}</span><h1>{OFFICE.title}</h1></div>
        </div>
        <div className="online"><span /> Онлайн-запис</div>
      </header>

      {/* БАНЕР ПОВІТРЯНОЇ ТРИВОГИ */}
      {isAirAlertActive && (
        <div className="air-alert-banner">
          <div className="air-alert-content">
            <ShieldAlert size={36} className="air-alert-icon" />
            <div>
              <h3>УВАГА! ПОВІТРЯНА ТРИВОГА В БОРОДЯНСЬКІЙ ГРОМАДІ</h3>
              <p>Прийом громадян та реєстрацію в чергу тимчасово призупинено. Всі працівники та відвідувачі повинні негайно пройти в укриття!</p>
            </div>
          </div>
        </div>
      )}

      <main>
        {/* ШАПКА З ВІДЖЕТОМ ТРИВОГИ */}
        <section className="hero">
          <div className="hero-text">
            <div className="hero-kicker">ЗРУЧНО · ПРОЗОРО · У ЗРУЧНИЙ ЧАС</div>
            <h2>Запишіться на прийом<br />у кілька кроків</h2>
            <p>Оберіть послугу, дату та доступний час або скористайтеся живою чергою. Особистий кабінет дозволить стежити за викликом прямо на сайті.</p>
          </div>
          
          <div className="hero-widget-box">
            <iframe 
              src="https://alerts.na-agency.com/widget?region=700&amp;type=card&amp;theme=light" 
              width="300" 
              height="190" 
              title="Повітряна тривога Бородянська громада" 
              loading="lazy" 
              style={{ border: 0, width: '300px', height: '190px', maxWidth: '100%', borderRadius: '14px', colorScheme: 'normal' }}
            />
            <p style={{ margin: '4px 0 0', font: '11px/1.4 sans-serif', textAlign: 'center' }}>
              <a 
                href="https://alerts.na-agency.com/region/700-borodianska-terytorialna-hromada" 
                target="_blank" 
                rel="noreferrer"
                style={{ color: '#d5e9fa', textDecoration: 'none' }}
              >
                Повітряна тривога Бородянська громада
              </a>
            </p>
          </div>
        </section>

        {/* НАВІГАЦІЯ */}
        <nav className="tabs" aria-label="Розділи">
          <button className={tab === 'book' ? 'selected' : ''} onClick={() => { setTab('book'); setError(''); }}>
            Записатися
          </button>
          
          <button className={tab === 'user' ? 'selected user-tab' : 'user-tab'} onClick={() => { setTab('user'); setError(''); }}>
            <User size={16} style={{ verticalAlign: 'middle', marginRight: '5px' }} />
            {session ? 'Мій кабінет' : 'Вхід / Реєстрація'}
          </button>

          <button className={tab === 'queue' ? 'selected' : ''} onClick={() => { setTab('queue'); setError(''); loadPublicQueue(); }}>
            Публічна черга
          </button>
          
          {isStaff && (
            <button className={tab === 'staff' ? 'selected' : ''} onClick={() => { setTab('staff'); setError(''); }}>
              Кабінет працівника
            </button>
          )}
        </nav>

        {/* 1. ЗАПИС НА ПРИЙОМ */}
        {tab === 'book' && (
          <section className="panel">
            <div className="section-head">
              <div className="symbol"><CalendarDays /></div>
              <div><h3>Новий запис</h3><p>Оберіть формат прийому та заповніть поля</p></div>
            </div>

            {!dayStatus.isWorking && (
              <div className={`status-warning-box ${isAirAlertActive ? 'alert-danger-box' : ''}`}>
                <h4 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={20} /> Запис на {formatDate(form.visit_date)} призупинено
                </h4>
                <p style={{ margin: '0' }}><strong>Причина:</strong> {dayStatus.reason}</p>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem' }}>Будь ласка, оберіть іншу дату або зачекайте на відновлення роботи кабінету.</p>
              </div>
            )}

            <div className="mode-switch">
              <button disabled={!dayStatus.isWorking} className={mode === 'scheduled' ? 'active' : ''} onClick={() => { setMode('scheduled'); updateForm('booking_type', 'scheduled'); }}>
                <CalendarCheck size={18} /> На конкретний час
              </button>
              <button disabled={!dayStatus.isWorking} className={mode === 'live' ? 'active' : ''} onClick={() => { setMode('live'); updateForm('booking_type', 'live'); updateForm('visit_date', kyivDate()); }}>
                <ListOrdered size={18} /> Жива черга сьогодні
              </button>
            </div>
            
            <form onSubmit={submitBooking}>
              <div className="form-grid">
                <label>ПІБ повністю *
                  <input required disabled={!dayStatus.isWorking} autoComplete="name" maxLength="150" value={form.full_name} onChange={e => updateForm('full_name', e.target.value)} placeholder="Прізвище Ім’я По батькові" />
                </label>
                <label>Номер телефону *
                  <input required disabled={!dayStatus.isWorking} type="tel" autoComplete="tel" maxLength="30" value={form.phone} onChange={e => updateForm('phone', e.target.value)} placeholder="+380…" />
                </label>

                <label>Послуга *
                  <select disabled={!dayStatus.isWorking} value={form.service} onChange={e => updateForm('service', e.target.value)}>
                    {SERVICES.map(item => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label>Дата прийому *
                  <input type="date" required min={kyivDate()} disabled={mode === 'live'} value={form.visit_date} onChange={e => updateForm('visit_date', e.target.value)} />
                  {mode === 'live' && <small>Для живої черги використовується поточна дата.</small>}
                </label>

                {mode === 'scheduled' ? (
                  <label className="slot-label">Вільний час *
                    <select required disabled={!dayStatus.isWorking || slotsLoading || slots.length === 0} value={form.appointment_time} onChange={e => updateForm('appointment_time', e.target.value)}>
                      <option value="">{!dayStatus.isWorking ? 'Прийом зупинено' : slotsLoading ? 'Завантажуємо години…' : slots.length ? 'Оберіть час' : 'Немає вільного часу'}</option>
                      {dayStatus.isWorking && slots.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <small>Слот резервується на сервері; одночасне бронювання одного часу не допускається.</small>
                  </label>
                ) : (<div></div>)}

                <label>Коментар до звернення (необов’язково)
                  <input disabled={!dayStatus.isWorking} maxLength="300" value={form.notes} onChange={e => updateForm('notes', e.target.value)} placeholder="Коротко уточніть запит" />
                </label>
              </div>

              <div className="privacy" style={{ marginTop: '1.25rem' }}>
                <ShieldCheck size={18} />
                <span>ПІБ, телефон і деталі запиту бачать лише авторизовані працівники. У відкритій черзі показуються тільки номер, час і статус.</span>
              </div>

              {error && <div className="alert error" role="alert">{error}</div>}
              {message && <div className="alert success" role="status">{message}</div>}

              <button className="primary" type="submit" disabled={!dayStatus.isWorking || busy || (mode === 'scheduled' && !slots.length)}>
                {busy ? 'Створюємо запис…' : mode === 'live' ? 'Отримати номер живої черги' : 'Підтвердити запис'} <ArrowRight size={18} />
              </button>
            </form>
            
            {receipt && (
              <div className="receipt">
                <div className="receipt-icon"><CalendarCheck /></div>
                <div>
                  <strong>Запис створено</strong>
                  <div className="ticket-number">№ {receipt.queue_number}</div>
                  <p>{formatDate(receipt.visit_date)} · {receipt.booking_type === 'live' ? 'Жива черга' : (receipt.appointment_time || 'час не вказано')}</p>
                  <p>Послуга: {receipt.service}</p>
                  <small>Ви можете стежити за своїм талоном на вкладці «Мій кабінет» або в публічній черзі.</small>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 2. ОСОБИСТИЙ КАБІНЕТ ГРОМАДЯНИНА */}
        {tab === 'user' && (
          <section className="panel">
            {!session ? (
              <div className="auth-container">
                <div className="section-head">
                  <div className="symbol"><User /></div>
                  <div>
                    <h3>{authMode === 'login' ? 'Вхід в особистий кабінет' : 'Реєстрація громадянина'}</h3>
                    <p>Для швидкого перегляду талонів і відстеження виклику</p>
                  </div>
                </div>

                <form className="login-form" onSubmit={handleAuth}>
                  {authMode === 'register' && (
                    <>
                      <label>ПІБ повністю *
                        <input required value={authForm.full_name} onChange={e => setAuthForm(prev => ({ ...prev, full_name: e.target.value }))} placeholder="Прізвище Ім’я По батькові" />
                      </label>
                      <label>Номер телефону *
                        <input required type="tel" value={authForm.phone} onChange={e => setAuthForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="+380..." />
                      </label>
                    </>
                  )}

                  <label>Електронна пошта або номер телефону *
                    <input required value={authForm.identifier} onChange={e => setAuthForm(prev => ({ ...prev, identifier: e.target.value }))} placeholder="email@example.com або +380..." />
                  </label>

                  <label>Пароль *
                    <input required type="password" value={authForm.password} onChange={e => setAuthForm(prev => ({ ...prev, password: e.target.value }))} placeholder="••••••••" />
                  </label>

                  <button className="primary" type="submit">
                    {authMode === 'login' ? 'Увійти в кабінет' : 'Зареєструватися'}
                  </button>

                  <div className="auth-switch-link">
                    {authMode === 'login' ? (
                      <p>Ще не маєте кабінету? <button type="button" onClick={() => { setAuthMode('register'); setError(''); }}>Зареєструватися</button></p>
                    ) : (
                      <p>Вже зареєстровані? <button type="button" onClick={() => { setAuthMode('login'); setError(''); }}>Увійти</button></p>
                    )}
                  </div>

                  {error && <div className="alert error">{error}</div>}
                  {message && <div className="alert success">{message}</div>}
                </form>
              </div>
            ) : (
              <div className="user-dashboard">
                <div className="staff-tools" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
                  <div className="staff-profile-card">
                    <div className="staff-avatar">
                      <UserCheck size={22} />
                    </div>
                    <div className="staff-info">
                      <div className="staff-name">{session.user.user_metadata?.full_name || session.user.email}</div>
                      <div className="staff-role">{session.user.user_metadata?.phone || 'Особистий кабінет'}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="icon-button" onClick={loadUserAppointments}>
                      <RefreshCw size={15} /> Оновити
                    </button>
                    <button className="quiet-button" onClick={handleSignOut}>
                      <LogOut size={15} /> Вийти
                    </button>
                  </div>
                </div>

                {activeUserTicket?.status === 'serving' && (
                  <div className="call-notification-banner">
                    <Volume2 size={36} className="alert-shake" />
                    <div>
                      <h3>ВАС ВИКЛИКАНО ДО ВІКНА ПРИЙОМУ!</h3>
                      <p>Талон <strong>№ {activeUserTicket.queue_number}</strong>. Будь ласка, негайно підійдіть до працівника паспортного столу.</p>
                    </div>
                  </div>
                )}

                {activeUserTicket ? (
                  <div className="digital-ticket-card">
                    <div className="ticket-badge">Активний талон</div>
                    <div className="ticket-big-number">№ {activeUserTicket.queue_number}</div>
                    <div className="ticket-status-pill">
                      Статус: <strong>{STATUS_LABELS[activeUserTicket.status] || activeUserTicket.status}</strong>
                    </div>

                    <div className="ticket-meta-grid">
                      <div>
                        <label>Дата прийому</label>
                        <span>{formatDate(activeUserTicket.visit_date)}</span>
                      </div>
                      <div>
                        <label>Час візиту</label>
                        <span>{activeUserTicket.booking_type === 'live' ? 'Жива черга' : activeUserTicket.appointment_time?.slice(0, 5)}</span>
                      </div>
                      <div className="full-width">
                        <label>Послуга</label>
                        <span>{activeUserTicket.service}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '15px' }}>
                      <button className="icon-button" onClick={() => window.print()}>
                        <Printer size={15} /> Друк талона
                      </button>
                      <button className="cancel-action" onClick={() => cancelUserAppointment(activeUserTicket.id)}>
                        <XCircle size={15} /> Скасувати запис
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="empty" style={{ margin: '20px 0' }}>
                    <Ticket size={28} />
                    <p>У вас немає активних талонів на прийом.</p>
                    <button className="primary" onClick={() => setTab('book')}>Записатися на прийом</button>
                  </div>
                )}

                <h4 style={{ margin: '30px 0 15px', color: '#1e293b' }}>Історія ваших звернень</h4>
                {userAppointments.filter(i => ['completed', 'cancelled'].includes(i.status)).length === 0 ? (
                  <p style={{ color: '#64748b', fontSize: '13px' }}>Попередніх завершених записів немає.</p>
                ) : (
                  <div className="queue-list">
                    {userAppointments.filter(i => ['completed', 'cancelled'].includes(i.status)).map(item => (
                      <div className="queue-row" key={item.id}>
                        <div className="queue-number">№ {item.queue_number}</div>
                        <div className="queue-main">
                          <b>{formatDate(item.visit_date)} · {item.service}</b>
                          <small>{displayTime(item)}</small>
                        </div>
                        <span className={`status ${item.status}`}>{STATUS_LABELS[item.status] || item.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* 3. ПУБЛІЧНА ЧЕРГА */}
        {tab === 'queue' && (
          <section className="panel">
            <div className="section-head">
              <div className="symbol"><ListOrdered /></div>
              <div><h3>Публічна черга</h3><p>Без ПІБ, телефонів і персональних деталей</p></div>
              <button className="icon-button" onClick={() => loadPublicQueue()} aria-label="Оновити чергу"><RefreshCw size={17} /> Оновити</button>
            </div>
            <label className="date-field">Дата<input type="date" value={visitDate} onChange={e => { setVisitDate(e.target.value); loadPublicQueue(e.target.value); }} /></label>
            <div className="queue-list">
              {filteredQueue.length === 0 ? (
                <div className="empty"><ListOrdered size={27} /><p>На цю дату записів не знайдено.</p><small>Нова інформація автоматично оновлюється кожні 20 секунд.</small></div>
              ) : (
                filteredQueue.map(item => (
                  <div className="queue-row" key={`${item.visit_date}-${item.queue_number}`}>
                    <div className="queue-number">№ {item.queue_number}</div>
                    <div className="queue-main"><b>{displayTime(item)}</b><small>{item.booking_type === 'live' ? 'Жива черга' : 'Попередній запис'}</small></div>
                    <span className={`status ${item.status}`}>{STATUS_LABELS[item.status] || item.status}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* 4. КАБІНЕТ ПРАЦІВНИКА */}
        {tab === 'staff' && isStaff && (
          <section className="panel">
            <div className="section-head">
              <div className="symbol"><ShieldCheck /></div>
              <div><h3>Кабінет працівника</h3><p>Керування чергою та прийомом громадян</p></div>
            </div>
            
            <div className="staff-tools" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <div className="staff-profile-card">
                <div className="staff-avatar">
                  {staffProfile.name ? staffProfile.name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() : 'ЯО'}
                </div>
                <div className="staff-info">
                  <div className="staff-name">{staffProfile.name}</div>
                  <div className="staff-role">
                    <span className="staff-status-dot"></span>
                    {staffProfile.role}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label style={{ margin: 0, minWidth: '150px' }}>
                  <input 
                    type="date" 
                    value={staffDate} 
                    onChange={e => { setStaffDate(e.target.value); loadStaffQueue(e.target.value); loadDayStatus(e.target.value); }} 
                    style={{ padding: '8px 12px' }}
                  />
                </label>
                <button className="icon-button" onClick={() => { loadStaffQueue(staffDate); loadDayStatus(staffDate); }} aria-label="Оновити список">
                  <RefreshCw size={15} /> Оновити
                </button>
                <button className="icon-button" onClick={exportToCSV} aria-label="Експорт в Excel" title="Завантажити звіт дня у CSV (Excel)">
                  <Download size={15} /> Експорт (Excel)
                </button>
                <button className="quiet-button" onClick={handleSignOut} aria-label="Вийти з кабінету">
                  <LogOut size={15} /> Вийти
                </button>
              </div>
            </div>

            <div className="staff-stats-grid">
              <div className="stat-card">
                <span className="stat-label">Усього талонів</span>
                <strong className="stat-value">{stats.total}</strong>
              </div>
              <div className="stat-card stat-waiting">
                <span className="stat-label">Очікують прийому</span>
                <strong className="stat-value">{stats.waiting}</strong>
              </div>
              <div className="stat-card stat-serving">
                <span className="stat-label">Зараз на прийомі</span>
                <strong className="stat-value">{stats.serving}</strong>
              </div>
              <div className="stat-card stat-completed">
                <span className="stat-label">Обслуговано</span>
                <strong className="stat-value">{stats.completed}</strong>
              </div>
            </div>

            <div style={{ background: '#f8fafc', padding: '1.25rem', border: '1px solid #e2e8f0', borderRadius: '12px', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <h4 style={{ margin: 0, color: '#334155' }}>
                  Статус прийому на {formatDate(staffDate)}
                </h4>
                {dayStatus.isWorking && (
                  <button 
                    type="button" 
                    onClick={() => updateDayStatus(false, 'Повітряна тривога в Бородянській громаді')}
                    className="cancel-action"
                    style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}
                  >
                    <Siren size={14} /> Оголосити тривогу (зупинити прийом)
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 300px' }}>
                  <input 
                    type="text" 
                    placeholder="Вкажіть причину зупинки (напр., Повітряна тривога або Технічні роботи)" 
                    value={statusReasonInput} 
                    onChange={(e) => setStatusReasonInput(e.target.value)} 
                    style={{ width: '100%', marginBottom: 0 }}
                  />
                </div>
                {dayStatus.isWorking ? (
                  <button className="cancel-action" onClick={() => updateDayStatus(false)} disabled={statusLoading}>
                    Зупинити прийом
                  </button>
                ) : (
                  <button className="primary" onClick={() => updateDayStatus(true)} disabled={statusLoading}>
                    Відновити прийом (Відбій)
                  </button>
                )}
              </div>
              {!dayStatus.isWorking && (
                <div style={{ marginTop: '0.75rem', color: '#b91c1c', fontSize: '0.9rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <AlertTriangle size={16} /> Прийом зупинено ({dayStatus.reason}).
                </div>
              )}
            </div>

            <div className="staff-filter-bar">
              <div className="search-box">
                <Search size={16} className="search-icon" />
                <input 
                  type="text"
                  placeholder="Швидкий пошук за ПІБ, телефоном або номером..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button className="clear-search" onClick={() => setSearchQuery('')}>×</button>
                )}
              </div>

              <div className="filter-chips">
                <button className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>
                  Усі ({stats.total})
                </button>
                <button className={statusFilter === 'waiting' ? 'active' : ''} onClick={() => setStatusFilter('waiting')}>
                  Очікують ({stats.waiting})
                </button>
                <button className={statusFilter === 'serving' ? 'active' : ''} onClick={() => setStatusFilter('serving')}>
                  На прийомі ({stats.serving})
                </button>
                <button className={statusFilter === 'completed' ? 'active' : ''} onClick={() => setStatusFilter('completed')}>
                  Завершені ({stats.completed})
                </button>
                <button className={statusFilter === 'cancelled' ? 'active' : ''} onClick={() => setStatusFilter('cancelled')}>
                  Скасовані ({stats.cancelled})
                </button>
              </div>
            </div>

            {error && <div className="alert error">{error}</div>}
            {message && <div className="alert success">{message}</div>}
            
            {staffLoading ? (
              <div className="empty">Завантаження черги…</div>
            ) : displayedStaffQueue.length === 0 ? (
              <div className="empty">
                <Users size={26} />
                <p>{searchQuery || statusFilter !== 'all' ? 'За обраними фільтрами записів не знайдено.' : 'На цю дату немає записів.'}</p>
              </div>
            ) : (
              <div className="staff-list">
                {displayedStaffQueue.map(item => (
                  <article className="staff-row" key={item.id}>
                    <div className="staff-details">
                      <div className="staff-title">
                        <b>№ {item.queue_number} · {item.full_name}</b>
                        <span className={`status ${item.status}`}>{STATUS_LABELS[item.status] || item.status}</span>
                      </div>
                      <p><strong>{item.service}</strong> · {item.booking_type === 'live' ? 'Жива черга' : `Час ${String(item.appointment_time || '').slice(0, 5)}`}</p>
                      <p>Телефон: <a href={`tel:${item.phone}`}>{item.phone}</a></p>
                      {item.notes && <p>Коментар: {item.notes}</p>}
                      <small>Створено: {new Date(item.created_at).toLocaleString('uk-UA')}</small>
                    </div>
                    <div className="actions">
                      <button disabled={item.status !== 'waiting'} onClick={() => staffAction(item.id, 'call')}>Викликати</button>
                      <button disabled={item.status !== 'serving'} onClick={() => staffAction(item.id, 'complete')}>Завершити</button>
                      <button className="cancel-action" disabled={['completed', 'cancelled'].includes(item.status)} onClick={() => staffAction(item.id, 'cancel')}>Скасувати</button>
                      
                      {['completed', 'cancelled'].includes(item.status) && (
                        <button 
                          style={{ background: '#dcfce7', color: '#15803d' }} 
                          onClick={() => staffAction(item.id, 'restore')} 
                          title="Повернути запис у чергу очікування"
                        >
                          <RotateCcw size={13} style={{ verticalAlign: 'middle', marginRight: '3px' }} /> Відновити
                        </button>
                      )}

                      <button className="cancel-action" style={{ background: '#fee2e2', color: '#dc2626' }} onClick={() => deleteAppointment(item.id)} title="Безповоротно видалити з бази">
                        <Trash2 size={13} style={{ verticalAlign: 'middle', marginRight: '3px' }} /> Видалити
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="info-grid">
          <article className="info-card">
            <Clock3 />
            <h4>Графік роботи</h4>
            <p>{OFFICE.hours}</p>
            {OFFICE.daysOff && <small style={{ display: 'block', marginTop: '6px', color: '#64748b' }}>{OFFICE.daysOff}</small>}
          </article>
          <article className="info-card">
            <UserCheck />
            <h4>Особистий кабінет</h4>
            <p>Усі ваші талони зберігаються на сайті. При виклику працівником пролунає звуковий сигнал безпосередньо у браузері.</p>
          </article>
        </section>
      </main>

      <footer>
        <span>© {OFFICE.subtitle} · {OFFICE.title}</span>
        <span>Автономна черга з особистим кабінетом.</span>
      </footer>
    </div>
  );
}
