import React, { useState, useEffect,useRef } from 'react';
import axios from 'axios';
import './index.css';
import './App.css';
import { THEMES, getInitialTheme, applyTheme } from "./theme";
import MedicineRecognizer from "./MedicineRecognizer";
import ChatWidget from "./ChatWidget";



axios.defaults.baseURL ="https://healbot-backend-production.up.railway.app/api";

const FREQ_META = {
  ONCE_DAILY:  { label: "Once a day",  requiredTimes: 1, stepDays: 1 },
  TWICE_DAILY: { label: "Twice a day", requiredTimes: 2, stepDays: 1 },
  THRICE_DAILY:{ label: "Thrice a day",requiredTimes: 3, stepDays: 1 },
  ONCE_WEEKLY: { label: "Once a week", requiredTimes: 1, stepDays: 7 },
  TWICE_WEEKLY:{ label: "Twice a week",requiredTimes: 2, stepDays: 7 },

  CUSTOM:      { label: "Custom",      requiredTimes: 1, stepDays: 1 },
};

const getRequiredTimes = (freq, form) => {
  if (freq === "CUSTOM") return Number(form?.customTimesCount || 1);
  return FREQ_META[freq]?.requiredTimes ?? 1;
};


const normalizeTimesArray = (times, required) => {
  const arr = Array.isArray(times) ? [...times] : [];
  const trimmed = arr.slice(0, required);
  while (trimmed.length < required) trimmed.push("");
  return trimmed;
};

const validateAddMedicineForm = (form) => {
  const errs = {};

  if (!form.name?.trim()) errs.name = "Medicine name required";
  if (!form.dosage?.toString().trim()) errs.dosage = "Dosage required";

  const required = getRequiredTimes(form.frequency, form);
  if (form.frequency === "CUSTOM") {
  const c = Number(form.customTimesCount);
  if (!Number.isInteger(c) || c < 1 || c > 6) errs.customTimesCount = "Times per day must be 1 to 6";

  const sd = Number(form.customStepDays);
  if (!Number.isInteger(sd) || sd < 1 || sd > 30) errs.customStepDays = "Repeat days must be 1 to 30";
}

  const times = Array.isArray(form.times) ? form.times : [];

  if (times.length !== required) errs.times = `Please add ${required} time(s)`;
  if (times.some(t => !t)) errs.times = `All ${required} time(s) are required`;

  const clean = times.filter(Boolean);
  const uniq = new Set(clean);
  if (clean.length !== uniq.size) errs.times = "Times must be different";

  if (form.startDate && form.endDate) {
    if (new Date(form.endDate) < new Date(form.startDate)) {
      errs.endDate = "End date must be after start date";
    }
  }

  return errs;
};



// -------------------- Common validators (OUTSIDE App) --------------------
const isRequired = (v) => String(v ?? "").trim().length > 0;

const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());

const isStrongPassword = (pass) => {
  const p = String(pass || "");
  return p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p);
};

const isValidIndianPhone = (phone) => {
  const p = String(phone || "").trim().replace(/\s+/g, "");
  return /^[6-9]\d{9}$/.test(p);
};

const isValidAge = (age) => {
  if (!isRequired(age)) return false;
  const n = Number(age);
  return Number.isFinite(n) && n >= 0 && n <= 120;
};

const isValidBloodType = (bt) => {
  if (!isRequired(bt)) return true; // optional
  return /^(A|B|AB|O)[+-]$/i.test(String(bt).trim());
};

// -------------------- Form validators (OUTSIDE App) --------------------
const validateLoginForm = (form) => {
  const e = {};
  if (!isRequired(form.email)) e.email = "Email required";
  else if (!isValidEmail(form.email)) e.email = "Valid email required";

  if (!isRequired(form.password)) e.password = "Password required";
  return e;
};

const validateSignupForm = (form) => {
  const e = {};
  if (!isRequired(form.name)) e.name = "Full name required";

  if (!isRequired(form.email)) e.email = "Email required";
  else if (!isValidEmail(form.email)) e.email = "Valid email required";

  if (!isRequired(form.password)) e.password = "Password required";
  else if (!isStrongPassword(form.password))
    e.password = "Password must be 8+ chars with A-Z, a-z, 0-9";

  if (!isRequired(form.confirmPassword)) e.confirmPassword = "Confirm password required";
  else if (form.password !== form.confirmPassword) e.confirmPassword = "Passwords don't match";

  return e;
};

const validateFamilyForm = (form) => {
  const e = {};
  if (!isRequired(form.name)) e.name = "Name required";
  if (!isRequired(form.relationship)) e.relationship = "Relationship required";

  if (!isValidAge(form.age)) e.age = "Valid age required (0-120)";
  if (!isValidBloodType(form.bloodType)) e.bloodType = "Blood type like A+, O-, AB+";

  if (!isRequired(form.phone)) e.phone = "Phone required";
  else if (!isValidIndianPhone(form.phone)) e.phone = "Valid 10-digit phone required";

  if (isRequired(form.emergency) && !isValidIndianPhone(form.emergency))
    e.emergency = "Valid 10-digit emergency phone required";

  return e;
};

const App = () => {
  const [currentPage, setCurrentPage] = useState('login');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [theme, setTheme] = useState(getInitialTheme());

  // Family & Medicines
  const [familyMembers, setFamilyMembers] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState('');
  const [todaySchedules, setTodaySchedules] = useState([]);
  const [upcomingSchedules, setUpcomingSchedules] = useState([]);
  const [upcomingPage, setUpcomingPage] = useState(0);
  const [medicines, setMedicines] = useState([]);
  const [history, setHistory] = useState([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historySort, setHistorySort] = useState('date_desc');
  
  const notifiedRef = useRef(new Set());     // same schedule repeat notify na ho
  const alarmAudioRef = useRef(null);        // alarm sound
  const [activeReminder, setActiveReminder] = useState(null); // popup



  const getTodayISO = () =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD

  const refreshSchedules = async () => {
    const today = getTodayISO();

    const [todayRes, upcomingRes] = await Promise.all([
      axios.get('/schedules', { params: { date: today } }),
      axios.get('/schedules', { params: { from: today } }),
    ]);

    setTodaySchedules(todayRes.data || []);
    setUpcomingSchedules(upcomingRes.data || []);
    setUpcomingPage(0);
  };

  // Profile
  const [profile, setProfile] = useState({
    name: 'Amit Sharma',
    email: 'amit@example.com',
    phone: '9876543210'
  });

  // Forms
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [signupForm, setSignupForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [addFamilyForm, setAddFamilyForm] = useState({
    name: '',
    relationship: '',
    age: '',
    bloodType: '',
    phone: '',
    emergency: '',
    history: ''
  });
  const [addMedicineForm, setAddMedicineForm] = useState({
    name: '',
    dosage: '',
    unit: 'mg',
    frequency: 'ONCE_DAILY',
    times: ['08:00'],
    startDate: '',
    endDate: '',
    notes: '',
    customTimesCount: 1,
    customStepDays: 1,

  });

  // Errors
  const [errors, setErrors] = useState({});

  // Notification permission
  useEffect(() => {
    if ('Notification' in window) {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

// Alarm checker (10 min before)
useEffect(() => {
  const interval = setInterval(() => {
    const now = Date.now();

    const list = [...(todaySchedules || []), ...(upcomingSchedules || [])];

    list.forEach((schedule) => {
      if (!schedule || schedule.status !== "pending") return;

      const scheduleTimeMs = new Date(schedule.scheduled_at).getTime();
      if (Number.isNaN(scheduleTimeMs)) return;

      const diff = scheduleTimeMs - now;

      // 10 minutes window
      if (!(diff > 0 && diff <= 10 * 60 * 1000)) return;

      // minutes left
      const minsLeft = Math.max(0, Math.ceil(diff / (60 * 1000)));

      // IST formatted datetime
      const whenText = new Date(scheduleTimeMs).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      // same schedule ko repeat notify mat karo
      if (notifiedRef.current.has(schedule.id)) return;
      notifiedRef.current.add(schedule.id);

      // In-app popup (always)
      setActiveReminder({
        scheduleId: schedule.id,
        medicine: schedule.medicine_name,
        whenText,
        minsLeft,
        dosage: schedule.dosage,
      });

      // Browser notification (only if allowed)
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("🔔 HealBot Reminder", {
          body: `${schedule.medicine_name} • ${whenText} • Take ${schedule.dosage} • ${minsLeft} min left`,
        });
      }

      alarmAudioRef.current?.play().catch(() => {});
    });
  }, 30000);

  return () => clearInterval(interval);
}, [todaySchedules, upcomingSchedules]);



  useEffect(() => {
  if (!familyMembers || familyMembers.length === 0) {
    setSelectedPatient('');
    return;
  }

  // agar current selectedPatient list me nahi hai, first member select kar do
  const exists = familyMembers.some(m => String(m.id) === String(selectedPatient));
  if (!exists) setSelectedPatient(String(familyMembers[0].id));
}, [familyMembers]);

    useEffect(() => {
      alarmAudioRef.current = new Audio('/alarm.mp3');
      alarmAudioRef.current.loop = true;
    }, []);

  const stopAlarm = () => {
    const a = alarmAudioRef.current;
    if (!a) return;
    a.pause();
    a.currentTime = 0;
  };


  // Load real data on dashboard
  useEffect(() => {
    if (currentPage === 'dashboard' && token) {
      const loadData = async () => {
        try {
          const [medRes, famRes, histRes] = await Promise.all([
            axios.get('/medicines'),
            axios.get('/family-members'),
            axios.get('/history')
          ]);

          setMedicines(medRes.data || []);
          setFamilyMembers(famRes.data || []);
          setHistory(histRes.data || []);
          await refreshSchedules();
        } catch (err) {
          console.error('Data load error:', err);
        }
      };

      loadData();
    }
  }, [currentPage, token]);

  // Token load on app start
useEffect(() => {
  const savedToken = localStorage.getItem('token');

  if (savedToken) {
    setToken(savedToken);
    axios.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`;
    setCurrentPage('dashboard');   // 👈 THIS WAS MISSING
  } else {
    setCurrentPage('login');
  }
}, []);

  useEffect(() => {
    if (!token) return;
    if (currentPage === 'history') fetchHistory();
  }, [token, currentPage, selectedPatient]);

  const handleLogin = async (e) => {
    e.preventDefault();

    const v = validateLoginForm(loginForm);
    if (Object.keys(v).length) return setErrors(v);

    try {
      const res = await axios.post('/auth/login', loginForm);
      const { token: tkn, user: userData } = res.data;

      localStorage.setItem('token', tkn);
      setToken(tkn);
      setUser(userData);
      axios.defaults.headers.common['Authorization'] = `Bearer ${tkn}`;

      setProfile({ name: userData.name, email: userData.email });
      setCurrentPage('dashboard');
      setErrors({});
    } catch (err) {
      setErrors({ general: err.response?.data?.error || 'Login failed' });
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();

    const v = validateSignupForm(signupForm);
    if (Object.keys(v).length) return setErrors(v);

    try {
      await axios.post('/auth/signup', {
        name: signupForm.name,
        email: signupForm.email,
        password: signupForm.password,
      });

      alert('Account created! Now login.');
      setCurrentPage('login');
      setErrors({});
    } catch (err) {
      setErrors({ general: err.response?.data?.error || 'Signup failed' });
    }
  };

  const addFamilyMember = async (e) => {
    e.preventDefault();

    const v = validateFamilyForm(addFamilyForm);
    if (Object.keys(v).length) return setErrors(v);

    try {
      const res = await axios.post('/family-members', addFamilyForm);
      setFamilyMembers([...familyMembers, res.data]);
      setSelectedPatient(String(res.data.id));


      setAddFamilyForm({
        name: '',
        relationship: '',
        age: '',
        bloodType: '',
        phone: '',
        emergency: '',
        history: '',
      });

      setErrors({});
      setCurrentPage('dashboard');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add');
    }
  };

  const addMedicine = async (e) => {
    e.preventDefault();

    const errs = validateAddMedicineForm(addMedicineForm);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});

    try {
      const res = await axios.post('/medicines', {
        ...addMedicineForm,
        patient_id: selectedPatient,
        times: addMedicineForm.times || ['08:00'],
      });

      setMedicines([...medicines, res.data]);
      await refreshSchedules();

      const histRes = await axios.get('/history', {
        params: { patient_id: selectedPatient },
      });
      setHistory(histRes.data || []);

      setAddMedicineForm({
        name: '',
        dosage: '',
        unit: 'mg',
        frequency: 'ONCE_DAILY',
        times: ['08:00'],
        startDate: '',
        endDate: '',
        notes: '',
      });

      setCurrentPage('dashboard');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add');
    }
  };

  const markTaken = async (id) => {
    try {
      await axios.put(`/schedules/${id}/taken`);

      const [, histRes] = await Promise.all([
        refreshSchedules(),
        axios.get('/history', { params: { patient_id: selectedPatient } }),
      ]);

      setHistory(histRes.data || []);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to mark taken');
    }
  };

  const fetchHistory = async () => {
    const res = await axios.get('/history', {
      params: { patient_id: selectedPatient }
    });
    setHistory(res.data || []);
  };

  const deleteMedicine = async (medicineId) => {
    try {
      await axios.delete(`/medicines/${medicineId}`);

      setMedicines(prev => prev.filter(m => m.id !== medicineId));
      setHistory(prev =>
        prev.filter(h => String(h.medicine_id ?? h.medicineId) !== String(medicineId))
      );

      const [medRes, histRes] = await Promise.all([
        axios.get('/medicines'),
        axios.get('/history', { params: { patient_id: selectedPatient } }),
        refreshSchedules(),
      ]);

      setMedicines(medRes.data || []);
      setHistory(histRes.data || []);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete medicine');
    }
  };

  const deleteSchedule = async (scheduleId) => {
  try {
    await axios.delete(`/schedules/${scheduleId}`);
    await refreshSchedules();
    const histRes = await axios.get('/history', { params: { patient_id: selectedPatient } });
    setHistory(histRes.data || []);
  } catch (err) {
    alert(err.response?.data?.error || 'Failed to delete dose');
  }
};


  const formatIST = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);

    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken('');
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);

    setMedicines([]);
    setFamilyMembers([]);
    setTodaySchedules([]);
    setHistory([]);
    setUpcomingSchedules([]);
    setUpcomingPage(0);

    setCurrentPage('login');
  };

  const deleteFamilyMember = async (memberId) => {
    try {
      await axios.delete(`/family-members/${memberId}`);

      setSelectedPatient(prev => (String(prev) === String(memberId) ? '' : prev));

      const [medRes, famRes, histRes] = await Promise.all([
        axios.get('/medicines'),
        axios.get('/family-members'),
        axios.get('/history'),
        refreshSchedules(),
      ]);

      setMedicines(medRes.data || []);
      setFamilyMembers(famRes.data || []);
      setHistory(histRes.data || []);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete family member');
    }
  };

  // -------------------- PAGES --------------------

  // Login Page
  if (currentPage === 'login') {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="logo">
            <div className="pill-icon">💊</div>
            <h1>HealBot</h1>
            <p>Family Medicine Tracker</p>
          </div>

          {errors.general && (
            <div style={{
              background: '#fee',
              color: '#c33',
              padding: '10px',
              borderRadius: '8px',
              marginBottom: '20px',
              textAlign: 'center'
            }}>
              {errors.general}
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div className="input-group">
              <input
                type="email"
                placeholder="Email"
                value={loginForm.email}
                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
              />
              {errors.email && <span className="error">{errors.email}</span>}
            </div>

            <div className="input-group">
              <input
                type="password"
                placeholder="Password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              />
              {errors.password && <span className="error">{errors.password}</span>}
            </div>

            <button type="submit" className="btn-primary full">Login</button>
          </form>

          <div className="auth-switch">
            Don't have account?
            <button className="link-btn" onClick={() => setCurrentPage('signup')}>
              Sign Up
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Signup Page
  if (currentPage === 'signup') {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="logo">
            <div className="pill-icon">💊</div>
            <h1>Create Account</h1>
          </div>

          {errors.general && (
            <div style={{
              background: '#fee',
              color: '#c33',
              padding: '10px',
              borderRadius: '8px',
              marginBottom: '20px',
              textAlign: 'center',
            }}>
              {errors.general}
            </div>
          )}

          <form onSubmit={handleSignup}>
            <div className="input-group">
              <input
                type="text"
                placeholder="Full Name"
                value={signupForm.name}
                onChange={(e) => setSignupForm({ ...signupForm, name: e.target.value })}
              />
              {errors.name && <span className="error">{errors.name}</span>}
            </div>

            <div className="input-group">
              <input
                type="email"
                placeholder="Email"
                value={signupForm.email}
                onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })}
              />
              {errors.email && <span className="error">{errors.email}</span>}
            </div>

            <div className="input-group">
              <input
                type="password"
                placeholder="Password"
                value={signupForm.password}
                onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })}
              />
              {errors.password && <span className="error">{errors.password}</span>}
            </div>

            <div className="input-group">
              <input
                type="password"
                placeholder="Confirm Password"
                value={signupForm.confirmPassword}
                onChange={(e) =>
                  setSignupForm({ ...signupForm, confirmPassword: e.target.value })
                }
              />
              {errors.confirmPassword && (
                <span className="error">{errors.confirmPassword}</span>
              )}
            </div>

            <button type="submit" className="btn-primary full">Sign Up</button>
          </form>

          <button className="btn-secondary full" onClick={() => setCurrentPage('login')}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  // Add Family Page
  if (currentPage === 'add-family') {
    return (
      <div className="app">
        <header className="header">
          <div className="logo-small">🩺 HealBot</div>
          <button className="btn-logout" onClick={() => setCurrentPage('dashboard')}>Back</button>
        </header>

        <div className="dashboard">
          <div className="section">
            <h2>Add Family Member</h2>

            <form onSubmit={addFamilyMember}>
              <div className="input-group">
                <input
                  placeholder="Name"
                  value={addFamilyForm.name}
                  onChange={(e) => setAddFamilyForm({ ...addFamilyForm, name: e.target.value })}
                />
                {errors.name && <span className="error">{errors.name}</span>}
              </div>

              <div className="input-group">
                <input
                  placeholder="Relationship (Father/Mother)"
                  value={addFamilyForm.relationship}
                  onChange={(e) => setAddFamilyForm({ ...addFamilyForm, relationship: e.target.value })}
                />
                {errors.relationship && <span className="error">{errors.relationship}</span>}
              </div>

              <div className="input-group">
                <input
                  placeholder="Age"
                  type="number"
                  value={addFamilyForm.age}
                  onChange={(e) => setAddFamilyForm({ ...addFamilyForm, age: e.target.value })}
                />
                {errors.age && <span className="error">{errors.age}</span>}
              </div>

              <div className="input-group">
                <input
                  placeholder="Blood Type (A+, O-, AB+)"
                  value={addFamilyForm.bloodType}
                  onChange={(e) => setAddFamilyForm({ ...addFamilyForm, bloodType: e.target.value })}
                />
                {errors.bloodType && <span className="error">{errors.bloodType}</span>}
              </div>

              <div className="input-group">
                <input
                  placeholder="Phone"
                  value={addFamilyForm.phone}
                  onChange={(e) => setAddFamilyForm({ ...addFamilyForm, phone: e.target.value })}
                />
                {errors.phone && <span className="error">{errors.phone}</span>}
              </div>

              <div className="input-group">
                <input
                  placeholder="Emergency Contact (optional)"
                  value={addFamilyForm.emergency}
                  onChange={(e) => setAddFamilyForm({ ...addFamilyForm, emergency: e.target.value })}
                />
                {errors.emergency && <span className="error">{errors.emergency}</span>}
              </div>

              <div className="input-group">
                <textarea
                  placeholder="Medical History"
                  value={addFamilyForm.history}
                  onChange={(e) => setAddFamilyForm({ ...addFamilyForm, history: e.target.value })}
                />
              </div>

              <div className="quick-actions">
                <button type="submit" className="btn-action">Add Member</button>
                <button type="button" className="btn-action" onClick={() => setCurrentPage('dashboard')}>Cancel</button>
              </div>
            </form>

          </div>
        </div>
        {token && <ChatWidget selectedPatient={selectedPatient} />}

      </div>
    );
  }

// Add Medicine Page
if (currentPage === 'add-medicine') {
  return (
    <div className="app">
      <header className="header">
        <div className="logo-small">🩺 HealBot</div>
        <button
          className="btn-logout"
          onClick={() => setCurrentPage('dashboard')}
        >
          Back
        </button>
      </header>

      <div className="dashboard">
        <div className="section">
          <h2>Add Medicine</h2>

          <form onSubmit={addMedicine}>
            {/* Medicine Name */}
            <div className="input-group">
              <input
                placeholder="Medicine Name"
                value={addMedicineForm.name}
                onChange={(e) =>
                  setAddMedicineForm({ ...addMedicineForm, name: e.target.value })
                }
              />
              {errors.name && <span className="error">{errors.name}</span>}
            </div>

            {/* Dosage / Unit / Frequency */}
            <div className="medicine-form-grid">
              <div className="input-group">
                <input
                  placeholder="Dosage (500)"
                  value={addMedicineForm.dosage}
                  onChange={(e) =>
                    setAddMedicineForm({ ...addMedicineForm, dosage: e.target.value })
                  }
                />
                {errors.dosage && <span className="error">{errors.dosage}</span>}
              </div>

              <div className="input-group">
                <select
                  value={addMedicineForm.unit}
                  onChange={(e) =>
                    setAddMedicineForm({ ...addMedicineForm, unit: e.target.value })
                  }
                >
                  <option>mg</option>
                  <option>ml</option>
                  <option>tablet</option>
                </select>
              </div>

              <div className="input-group">
                <select
                  value={addMedicineForm.frequency}
                  onChange={(e) => {
                    const newFreq = e.target.value;

                    setAddMedicineForm((prev) => {
                      const required = getRequiredTimes(newFreq, prev);

                      return {
                        ...prev,
                        frequency: newFreq,
                        times: normalizeTimesArray(prev.times, required),
                      };
                    });
                  }}
                >
                  {Object.entries(FREQ_META).map(([value, meta]) => (
                    <option key={value} value={value}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

{addMedicineForm.frequency === "CUSTOM" && (
  <div className="custom-mini">
    <div className="custom-mini-row">
      <span>Custom schedule</span>
      <span className="custom-mini-chip">
        {addMedicineForm.customTimesCount}x/day • {addMedicineForm.customStepDays}d gap
      </span>
    </div>

    <div className="custom-mini-grid">
      <div className="input-group" style={{ marginBottom: 0 }}>
        <input
          type="number"
          min="1"
          max="6"
          placeholder="Times/day (1-6)"
          value={addMedicineForm.customTimesCount}
          onChange={(e) => {
            const v = Number(e.target.value || 1);
            setAddMedicineForm((prev) => ({
              ...prev,
              customTimesCount: v,
              times: normalizeTimesArray(prev.times, v),
            }));
          }}
        />
        {errors.customTimesCount && (
          <span className="error">{errors.customTimesCount}</span>
        )}
      </div>

      <div className="input-group" style={{ marginBottom: 0 }}>
        <input
          type="number"
          min="1"
          max="30"
          placeholder="Repeat gap days (1-30)"
          value={addMedicineForm.customStepDays}
          onChange={(e) => {
            const v = Number(e.target.value || 1);
            setAddMedicineForm((prev) => ({ ...prev, customStepDays: v }));
          }}
        />
        {errors.customStepDays && (
          <span className="error">{errors.customStepDays}</span>
        )}
      </div>
    </div>

    <div className="custom-mini-help">
      Tip: 1 = daily, 2 = alternate days.
    </div>
  </div>
)}




            {/* Time inputs */}
            {addMedicineForm.times.map((time, idx) => (
              <div className="input-group" key={idx}>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAddMedicineForm((prev) => {
                      const next = [...prev.times];
                      next[idx] = v;
                      return { ...prev, times: next };
                    });
                  }}
                />
              </div>
            ))}
            {errors.times && <span className="error">{errors.times}</span>}

            {/* Dates */}
            <div className="input-group">
              <input
                type="date"
                placeholder="Start Date"
                value={addMedicineForm.startDate}
                onChange={(e) =>
                  setAddMedicineForm({ ...addMedicineForm, startDate: e.target.value })
                }
              />
            </div>

            <div className="input-group">
              <input
                type="date"
                placeholder="End Date"
                value={addMedicineForm.endDate}
                onChange={(e) =>
                  setAddMedicineForm({ ...addMedicineForm, endDate: e.target.value })
                }
              />
              {errors.endDate && <span className="error">{errors.endDate}</span>}
            </div>

            {/* Notes */}
            <div className="input-group">
              <textarea
                placeholder="Notes"
                value={addMedicineForm.notes}
                onChange={(e) =>
                  setAddMedicineForm({ ...addMedicineForm, notes: e.target.value })
                }
              />
            </div>

            {/* Actions */}
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Add Medicine
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCurrentPage('dashboard')}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
      {token && <ChatWidget selectedPatient={selectedPatient} />}

    </div>
  );
}

// Recognize Medicine Page
if (currentPage === "recognize") {
  return (
    <div className="app">
      <header className="header">
        <div className="logo-small">HealBot</div>
        <button className="btn-logout" onClick={() => setCurrentPage("dashboard")}>
          Back
        </button>
      </header>

      <div className="dashboard">
        <MedicineRecognizer onBack={() => setCurrentPage("dashboard")} />
      </div>
      {token && <ChatWidget selectedPatient={selectedPatient} />}

    </div>
  );
}



  // Profile Page
  if (currentPage === 'profile') {
    const patient = familyMembers.find(p => String(p.id) === String(selectedPatient));
    return (
      <div className="app">
        <header className="header">
          <div className="logo-small">🩺 HealBot</div>
          <button className="btn-logout" onClick={() => setCurrentPage('dashboard')}>Back</button>
        </header>
        <div className="dashboard">
          <div className="section">
            <h2>Profile - {patient?.name}</h2>
            <div style={{ display: 'grid', gap: '15px' }}>
              <div><strong>Name:</strong> {patient?.name}</div>
              <div><strong>Relationship:</strong> {patient?.relationship}</div>
              <div><strong>Age:</strong> {patient?.age}</div>
              <div><strong>Blood Type:</strong> {patient?.bloodType}</div>
              <div><strong>Phone:</strong> {patient?.phone}</div>
              <div><strong>Emergency:</strong> {patient?.emergency}</div>
              <div><strong>Medical History:</strong> {patient?.history}</div>
            </div>
            <div className="quick-actions inline" style={{ marginTop: '30px' }}>
              <button className="btn-action" onClick={() => setCurrentPage('dashboard')}>Dashboard</button>
            </div>
          </div>
        </div>
        {token && <ChatWidget selectedPatient={selectedPatient} />}

      </div>
    );
  }


const getWhenMs = (h) => new Date(h.taken_at || h.scheduled_at || h.takenAt || h.scheduledAt).getTime();

const filteredSortedHistory = (history || [])
  .filter((h) => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return true;

    return (
      String(h.medicine || '').toLowerCase().includes(q) ||
      String(h.dosage || '').toLowerCase().includes(q) ||
      String(h.status || '').toLowerCase().includes(q) ||
      String(h.patient_name || h.patientName || '').toLowerCase().includes(q) ||
      String(h.frequency || '').toLowerCase().includes(q) ||
      String(h.time || '').toLowerCase().includes(q)
    );
  })
  .sort((a, b) => {
    if (historySort === 'date_desc') return getWhenMs(b) - getWhenMs(a);
    if (historySort === 'date_asc') return getWhenMs(a) - getWhenMs(b);

    if (historySort === 'time_asc') return String(a.time || '').localeCompare(String(b.time || ''));
    if (historySort === 'time_desc') return String(b.time || '').localeCompare(String(a.time || ''));

    if (historySort === 'medicine_asc') return String(a.medicine || '').localeCompare(String(b.medicine || ''));
    if (historySort === 'medicine_desc') return String(b.medicine || '').localeCompare(String(a.medicine || ''));

    if (historySort === 'frequency_asc') return String(a.frequency || '').localeCompare(String(b.frequency || ''));
    if (historySort === 'frequency_desc') return String(b.frequency || '').localeCompare(String(a.frequency || ''));

    return 0;
  });

  // History Page
  
  if (currentPage === 'history') {
    
    return (
      <div className="app">
        <header className="header">
          <div className="logo-small">🩺 HealBot</div>
          <button className="btn-logout" onClick={() => setCurrentPage('dashboard')}>Back</button>
        </header>
        <div className="dashboard">
          <div className="section">
            <h2>Medicine History</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 15 }}>
              <input
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search medicine / dosage / status / time..."
                style={{ padding: 10, borderRadius: 10, border: '1px solid #e2e8f0', minWidth: 260 }}
              />

              <select
                value={historySort}
                onChange={(e) => setHistorySort(e.target.value)}
                style={{ padding: 10, borderRadius: 10, border: '1px solid #e2e8f0' }}
              >
                <option value="date_desc">Date: Newest first</option>
                <option value="date_asc">Date: Oldest first</option>
                <option value="time_asc">Time: Asc</option>
                <option value="time_desc">Time: Desc</option>
                <option value="frequency_asc">Frequency: Asc</option>
                <option value="frequency_desc">Frequency: Desc</option>
                <option value="medicine_asc">Medicine: A-Z</option>
                <option value="medicine_desc">Medicine: Z-A</option>
              </select>
            </div>

            <div className="schedule-list">
              {filteredSortedHistory.map(item => {
                const status = item.status || 'taken';
                const when =
                  status === 'taken'
                    ? (item.taken_at || item.takenAt)
                    : (item.scheduled_at || item.scheduledAt);

                return (
                  <div key={item.id} className={`schedule-item ${status}`}>
                    <div className="schedule-time">{formatIST(when)}</div>

                    <div className="schedule-info">
                      <div className="schedule-medicine">
                        {item.medicine}
                        <span style={{ opacity: 0.7, marginLeft: 8 }}>
                          ({item.patient_name || item.patientName || 'Patient'})
                        </span>
                      </div>

                      <div className="schedule-dosage">
                        {item.dosage}
                        <span style={{ opacity: 0.7, marginLeft: 8 }}>
                          [{String(status).toUpperCase()}]
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        </div>
        {token && <ChatWidget selectedPatient={selectedPatient} />}

      </div>
    );
  }

  // Dashboard
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo-small">🩺 HealBot</div>
        <div className="header-right">
          <div className="theme-switcher">
            <select
              className="theme-select"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              {THEMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <span>Welcome, {profile.name}</span>
          <button className="btn-logout" onClick={logout}>Logout</button>
        </div>
      </header>

      <div className="dashboard">
        {/* Stats Cards */}
        <div className="stats-grid">
          <div className="stat-card orange">
            <h3>Today's Dosage</h3>
            <div className="stat-number">{todaySchedules.length}</div>
          </div>
          <div className="stat-card blue">
            <h3>Total Medicines</h3>
            <div className="stat-number">{medicines.length}</div>
          </div>
          <div className="stat-card green">
            <h3>Taken Today</h3>
            <div className="stat-number">{todaySchedules.filter(s => s.status === 'taken').length}</div>
          </div>
          <div className="stat-card yellow">
            <h3>Pending</h3>
            <div className="stat-number">{todaySchedules.filter(s => s.status === 'pending').length}</div>
          </div>
        </div>

        {/* Patient Selector */}
        <div className="patient-selector">
          <h2>Select Patient</h2>
          <div className="patients-grid">
            {familyMembers.map(member => (
              <div
                key={member.id}
                className={`patient-card ${String(selectedPatient) === String(member.id) ? 'active' : ''}`}
                onClick={() => setSelectedPatient(member.id)}
              >
                <div className="patient-name">{member.name}</div>
                <div className="patient-rel">{member.relationship}</div>

                {String(member.id) !== '1' && (
                  <button
                    className="delete-patient"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete ${member.name}?`)) {
                        deleteFamilyMember(member.id);
                      }
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}

            <button className="add-patient-btn" onClick={() => setCurrentPage('add-family')}>
              ➕ Add Family
            </button>
          </div>
        </div>

        {/* Today's Schedule */}
        <div className="section">
          <h2>Today's Medicines</h2>

          {(() => {
            const selectedId = String(selectedPatient ?? '');

            // Patient ki medicines (patient_id match)
            const patientMedicines = medicines.filter(m =>
              String(m.patient_id ?? m.patientId) === selectedId
            );

            // Fast lookup: medicine_id -> medicine object
            const medMap = new Map(patientMedicines.map(m => [String(m.id), m]));

            // Patient ke schedules: schedule.medicine_id se match
            const patientSchedules = todaySchedules.filter(s =>
              medMap.has(String(s.medicine_id ?? s.medicineId))
            );

            if (patientSchedules.length === 0) {
              const patientName =
                familyMembers.find(m => String(m.id) === selectedId)?.name || 'selected patient';

              return (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>💊</div>
                  <h3>No Medicines</h3>
                  <p>No medicines found for <strong>{patientName}</strong></p>
                  <button
                    className="btn-action btn-cta"
                    onClick={() => setCurrentPage('add-medicine')}
                    style={{ marginTop: '1rem' }}
                  >
                    ➕ Add Medicine for {patientName}
                  </button>
                </div>
              );
            }

            return (
              <div className="schedule-list">
                {patientSchedules.map(schedule => {
                  const medId = String(schedule.medicine_id ?? schedule.medicineId);
                  const med = medMap.get(medId);

                  return (
                    <div key={schedule.id} className={`schedule-item ${schedule.status}`}>
                      <div className="schedule-time">{schedule.time}</div>

                      <div className="schedule-info">
                        <div className="schedule-medicine">{med?.name || 'Medicine'}</div>
                        <div className="schedule-dosage">
                          {schedule.dosage || `${med?.dosage ?? ''} ${med?.unit ?? ''}`.trim()}
                        </div>
                      </div>

                      <div className="schedule-actions">
                        {schedule.status === 'pending' && (
                          <button className="btn-taken" onClick={() => markTaken(schedule.id)}>
                            ✅ Taken
                          </button>
                        )}

                        <button
                          className="btn-delete"
                          onClick={() => {
                            if (window.confirm('Delete this dose (only this time)?')) {
                              deleteSchedule(schedule.id);
                            }
                          }}
                        >
                          🗑️ Delete
                        </button>

                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* Upcoming Medicines */}
        <div className="section">
          <h2>Upcoming Medicines</h2>

          {(() => {
            const selectedId = String(selectedPatient ?? "");

            const patientMedicines = medicines.filter(
              (m) => String(m.patient_id ?? m.patientId) === selectedId
            );

            const medMap = new Map(patientMedicines.map((m) => [String(m.id), m]));

            const patientUpcoming = upcomingSchedules.filter((s) =>
              medMap.has(String(s.medicine_id ?? s.medicineId))
            );

            const sorted = [...patientUpcoming].sort(
              (a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)
            );

            const perPage = 2;
            const start = upcomingPage * perPage;
            const pageItems = sorted.slice(start, start + perPage);

            const hasNext = start + perPage < sorted.length;
            const hasPrev = upcomingPage > 0;

            if (sorted.length === 0) {
              return (
                <div style={{ textAlign: "center", padding: 20, opacity: 0.7 }}>
                  No upcoming medicines.
                </div>
              );
            }

            return (
              <>
                <div className="schedule-list">
                  {pageItems.map((s) => {
                    const medId = String(s.medicine_id ?? s.medicineId);
                    const med = medMap.get(medId);

                    const patient = familyMembers.find(
                      (p) => String(p.id) === String(med?.patient_id ?? med?.patientId)
                    );

                    return (
                      <div key={s.id} className={`schedule-item ${s.status || ""}`}>
                        <div className="schedule-time">
                          {formatIST(s.scheduled_at)}
                        </div>

                        <div className="schedule-info">
                          <div className="schedule-medicine">
                            {med?.name || "Medicine"}
                            <span style={{ opacity: 0.7, marginLeft: 8 }}>
                              ({patient?.name || "Patient"})
                            </span>
                          </div>

                          <div className="schedule-dosage">{s.dosage}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="quick-actions inline" style={{ marginTop: 10 }}>
                  <button
                    className="btn-action"
                    disabled={!hasPrev}
                    onClick={() => setUpcomingPage((p) => Math.max(0, p - 1))}
                  >
                    Back
                  </button>

                  <button
                    className="btn-action"
                    disabled={!hasNext}
                    onClick={() => setUpcomingPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </>
            );
          })()}
        </div>

        {/* Quick Actions */}
        <div className="quick-actions inline">
          <button className="btn-action" onClick={() => setCurrentPage('add-medicine')}>
            ➕ Add Medicine
          </button>
          
          <button className="btn-action" onClick={() => setCurrentPage('profile')}>
            👤 Profile
          </button>
          <button className="btn-action" onClick={() => setCurrentPage('history')}>
            📜 History
          </button>
          <button className="btn-action" onClick={() => setCurrentPage("recognize")}>
            Recognize Medicine
          </button>
          <button
          className="btn-action"
          onClick={async () => {
            if (!('Notification' in window)) return alert('Notifications not supported');
            const p = await Notification.requestPermission();
            alert('Permission: ' + p);
          }}
        >
          Enable Notifications
        </button>

        </div>
      </div>
      {token && <ChatWidget selectedPatient={selectedPatient} />}
        {activeReminder && (
  <div className="reminder-toast">
    <div className="reminder-title">{activeReminder.medicine}</div>
    <div className="reminder-sub">
      {activeReminder.whenText} • Take {activeReminder.dosage} ({activeReminder.minsLeft} min left)
    </div>


    <div className="reminder-actions">
      <button
        className="btn-action"
        onClick={async () => {
          await markTaken(activeReminder.scheduleId); // already exists [file:1]
          stopAlarm();
          setActiveReminder(null);
        }}
      >
        Mark Taken
      </button>

      <button
        className="btn-action"
        onClick={() => {
          stopAlarm();
          setActiveReminder(null);
        }}
      >
        Dismiss
      </button>
    </div>
  </div>
)}

    </div>
  );
};

export default App;
