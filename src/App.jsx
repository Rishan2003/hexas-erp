import React, { useState, useEffect, createContext, useContext, useMemo, useCallback, useRef } from 'react';
import { 
  Calendar, LayoutDashboard, Users, BookOpen, Clock, 
  AlertTriangle, Plus, X, Edit2, Trash2, Check, MapPin, 
  GraduationCap, CalendarDays, BarChart3, DatabaseZap, Map, Settings, Briefcase, ClipboardList,
  Download, Upload, LogOut, Lock, Mail, Loader2, ChevronLeft, ChevronRight, ShieldAlert, Building2
} from 'lucide-react';

// --- SUPABASE CONFIGURATION ---
const supabaseUrl = "https://fmiltvytynakqcxldazr.supabase.co"; 
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtaWx0dnl0eW5ha3FjeGxkYXpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMzQ1MjQsImV4cCI6MjA5MDYxMDUyNH0.bCTIUamLnuXO8xKVutnMztr08jmjWMbuoVaff2sSVwM"; 

const isConfigured = Boolean(supabaseUrl && supabaseKey);

// --- UTILITIES ---
const generateId = () => Math.random().toString(36).substr(2, 9); // Used only for local preview states now

const parseTime = (timeStr) => {
  if (!timeStr) return { hours: 0, minutes: 0 };
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
};

const createDateFromTime = (dateStr, timeStr) => {
  if (!dateStr || !timeStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  const { hours, minutes } = parseTime(timeStr);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
};

const hasOverlap = (start1, end1, start2, end2) => {
  return start1 < end2 && end1 > start2;
};

const getWeekRange = (date = new Date()) => {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay()); 
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6); 
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const formatTime = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

// --- SUPABASE API SERVICE ---
const apiService = {
  async fetchProfile(supabaseClient, userId) {
    const { data, error } = await supabaseClient.from('profiles').select('*, branches(name)').eq('id', userId).single();
    if (error) throw new Error(error.message);
    return data;
  },

  async fetchBranches(supabaseClient) {
    const { data, error } = await supabaseClient.from('branches').select('*').order('created_at', { ascending: true }).limit(10000);
    if (error) throw new Error(error.message);
    return data || [];
  },

  async createBranch(supabaseClient, branch) {
    const { data, error } = await supabaseClient.from('branches').insert(branch).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  // FIX: Pagination helper to bypass Supabase's hard 1000 row API limit
  async fetchAllSessions(supabaseClient, branchId) {
    let allSessions = [];
    let from = 0;
    const step = 1000;
    
    while (true) {
      let sQuery = supabaseClient.from('sessions').select('*').range(from, from + step - 1);
      if (branchId) {
        sQuery = sQuery.eq('branch_id', branchId);
      }
      
      const { data, error } = await sQuery;
      if (error) throw new Error(error.message);
      
      if (data) allSessions = allSessions.concat(data);
      
      // If we got fewer rows than the step size, we've hit the end of the database table
      if (!data || data.length < step) {
        break; 
      }
      from += step;
    }
    
    return allSessions;
  },

  async fetchAll(supabaseClient, branchId) {
    let tQuery = supabaseClient.from('teachers').select('*').limit(10000);
    let cQuery = supabaseClient.from('classrooms').select('*').limit(10000);
    let pQuery = supabaseClient.from('programs').select('*').limit(10000);

    // Dynamically filter by branch if an ID is provided
    if (branchId) {
      tQuery = tQuery.eq('branch_id', branchId);
      cQuery = cQuery.eq('branch_id', branchId);
      pQuery = pQuery.eq('branch_id', branchId);
    }

    const [t, c, p] = await Promise.all([tQuery, cQuery, pQuery]);
    
    if (t.error) throw new Error(t.error.message);
    if (c.error) throw new Error(c.error.message);
    if (p.error) throw new Error(p.error.message);

    // Use our new paginated fetcher for sessions
    const sessions = await this.fetchAllSessions(supabaseClient, branchId);

    return { 
      teachers: t.data || [], 
      classrooms: c.data || [], 
      programs: p.data || [], 
      sessions: sessions 
    };
  },

  async createProgram(supabaseClient, program, sessions) {
    const { id, ...programPayload } = program; 
    const { data: pData, error: pError } = await supabaseClient.from('programs').insert(programPayload).select().single();
    if (pError) throw new Error(pError.message);
    
    const sessionsWithProgId = sessions.map(s => {
      const { id: sId, ...sPayload } = s; 
      return { ...sPayload, program_id: pData.id, branch_id: program.branch_id };
    });
    const { data: sData, error: sError } = await supabaseClient.from('sessions').insert(sessionsWithProgId).select();
    if (sError) throw new Error(sError.message);
    return { program: pData, sessions: sData };
  },

  async updateProgram(supabaseClient, program, sessions) {
    const { error: pError } = await supabaseClient.from('programs').update(program).eq('id', program.id);
    if (pError) throw new Error(pError.message);

    await supabaseClient.from('sessions').delete().eq('program_id', program.id);
    
    const sessionsWithProgId = sessions.map(s => {
      const { id: sId, ...sPayload } = s; 
      return { ...sPayload, program_id: program.id, branch_id: program.branch_id };
    });
    
    const { data: sData, error: sError } = await supabaseClient.from('sessions').insert(sessionsWithProgId).select();
    if (sError) throw new Error(sError.message);
    return { program, sessions: sData };
  },

  async deleteProgram(supabaseClient, id) {
    const { error } = await supabaseClient.from('programs').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async createSession(supabaseClient, session) {
    const { id, ...payload } = session;
    const { data, error } = await supabaseClient.from('sessions').insert(payload).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async updateSession(supabaseClient, session) {
    const { data, error } = await supabaseClient.from('sessions').update(session).eq('id', session.id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async deleteSession(supabaseClient, id) {
    const { error } = await supabaseClient.from('sessions').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async createTeacher(supabaseClient, teacher) {
    const { id, ...payload } = teacher;
    const { data, error } = await supabaseClient.from('teachers').insert(payload).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async updateTeacher(supabaseClient, teacher) {
    const { data, error } = await supabaseClient.from('teachers').update(teacher).eq('id', teacher.id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async deleteTeacher(supabaseClient, id) {
    const { error } = await supabaseClient.from('teachers').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async createClassroom(supabaseClient, classroom) {
    const { id, ...payload } = classroom;
    const { data, error } = await supabaseClient.from('classrooms').insert(payload).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async updateClassroom(supabaseClient, classroom) {
    const { data, error } = await supabaseClient.from('classrooms').update(classroom).eq('id', classroom.id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async deleteClassroom(supabaseClient, id) {
    const { error } = await supabaseClient.from('classrooms').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
};

// --- CONTEXT ---
const StoreContext = createContext();

const StoreProvider = ({ children }) => {
  const [supabaseClient, setSupabaseClient] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [data, setData] = useState({ teachers: [], classrooms: [], programs: [], sessions: [] });
  const [branches, setBranches] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [globalError, setGlobalError] = useState(null);
  const [libLoaded, setLibLoaded] = useState(false);

  useEffect(() => {
    if (!isConfigured) return;
    if (window.supabase) {
      setSupabaseClient(window.supabase.createClient(supabaseUrl, supabaseKey));
      setLibLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.7/dist/umd/supabase.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      try {
        if (window.supabase) {
          setSupabaseClient(window.supabase.createClient(supabaseUrl, supabaseKey));
          setLibLoaded(true);
        } else {
          setGlobalError("Supabase library failed to initialize globally.");
        }
      } catch (err) { setGlobalError(err.message || "Script initialization error."); }
    };
    script.onerror = () => setGlobalError("Failed to load Supabase script from CDN.");
    document.head.appendChild(script);
  }, []);

  const refreshData = useCallback(async (activeBranchId) => {
    if (!supabaseClient) return;
    try {
      const fetched = await apiService.fetchAll(supabaseClient, activeBranchId);
      setData(fetched);
      
      const fetchedBranches = await apiService.fetchBranches(supabaseClient);
      setBranches(fetchedBranches);
    } catch (err) {
      console.error("Data fetch error:", err);
      setGlobalError(err.message || "Failed to load branch data.");
    }
  }, [supabaseClient]);

  useEffect(() => {
    if (!supabaseClient) return;

    const initSession = async () => {
      try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        handleSession(session);
      } catch (err) {
        console.error("Session fetch error:", err);
        setIsLoading(false);
      }
    };

    const handleSession = async (session) => {
      const currentUser = session?.user || null;
      setUser(currentUser);
      
      if (currentUser) {
        try {
          const userProfile = await apiService.fetchProfile(supabaseClient, currentUser.id);
          setProfile(userProfile);
          await refreshData(userProfile.branch_id);
        } catch (err) {
          console.error("Profile fetch error:", err);
          setGlobalError(err.message || "Failed to load user profile.");
        }
      } else {
        setProfile(null);
        setData({ teachers: [], classrooms: [], programs: [], sessions: [] });
        setBranches([]);
      }
      setIsLoading(false);
    };

    initSession();

    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      setIsLoading(true);
      handleSession(session);
    });

    return () => { subscription?.unsubscribe(); };
  }, [supabaseClient, refreshData]);

  // Expose function to instantly switch the active branch data for Super Admins
  const switchBranch = async (branchId) => {
    if (profile?.role !== 'super_admin') return;
    const newProfile = { ...profile, branch_id: branchId || null };
    setProfile(newProfile);
    await refreshData(newProfile.branch_id);
  };

  // Profile-based link assignment
  const assignManagerToBranch = async (email, branchId) => {
    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .update({ branch_id: branchId })
        .eq('email', email)
        .select();
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
         throw new Error("User not found. Ensure they are added in the Supabase Auth Dashboard first.");
      }
      alert(`Successfully linked ${email} to the selected branch.`);
    } catch (err) {
      alert(err.message);
    }
  };

  const { teachers, classrooms, programs, sessions } = data;

  const withBranch = (payload) => ({ ...payload, branch_id: profile?.branch_id });

  const findConflicts = useCallback((start, end, teacherIds, classroomId, excludeSessionId = null, excludeProgramId = null) => {
    const conflicts = [];
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();

    (sessions || []).forEach(session => {
      if (excludeSessionId && session.id === excludeSessionId) return;
      if (excludeProgramId && session.program_id === excludeProgramId) return;
      
      const sStart = new Date(session.start_time).getTime();
      const sEnd = new Date(session.end_time).getTime();

      if (hasOverlap(startTime, endTime, sStart, sEnd)) {
        if (classroomId && session.assigned_classroom === classroomId) {
          conflicts.push(`Classroom conflict with: ${session.title}`);
        }
        const sharedTeachers = (teacherIds || []).filter(id => (session.assigned_teachers || []).includes(id));
        if (sharedTeachers.length > 0) {
          const tNames = sharedTeachers.map(id => teachers.find(t => t.id === id)?.name).join(', ');
          conflicts.push(`Teacher conflict (${tNames}) with: ${session.title}`);
        }
      }
    });
    return conflicts;
  }, [sessions, teachers]);

  const generateProgramSessions = (program) => {
    const generated = [];
    if (!program.start_date || !program.end_date) return [];
    const [startYear, startMonth, startDay] = program.start_date.split('-').map(Number);
    const [endYear, endMonth, endDay] = program.end_date.split('-').map(Number);
    
    let current = new Date(startYear, startMonth - 1, startDay);
    const end = new Date(endYear, endMonth - 1, endDay);
    end.setHours(23, 59, 59, 999);

    while (current <= end) {
      if ((program.days_of_week || []).includes(current.getDay())) {
        const dateStr = [
          current.getFullYear(),
          String(current.getMonth() + 1).padStart(2, '0'),
          String(current.getDate()).padStart(2, '0')
        ].join('-');

        const sessionStart = createDateFromTime(dateStr, program.start_time);
        const sessionEnd = createDateFromTime(dateStr, program.end_time);
        const sessionType = program.type === 'batch' ? 'batch_session' : 
                            program.type === 'club' ? 'club_session' : program.type;

        generated.push(withBranch({
          id: generateId(), 
          title: `${program.name}`,
          type: sessionType,
          assigned_teachers: program.assigned_teachers || [],
          assigned_classroom: program.assigned_classroom,
          start_time: sessionStart.toISOString(),
          end_time: sessionEnd.toISOString(),
          program_id: program.id
        }));
      }
      current.setDate(current.getDate() + 1);
    }
    return generated;
  };

  const saveProgram = async (program, generatedSessions) => {
    try { await apiService.createProgram(supabaseClient, withBranch(program), generatedSessions); await refreshData(profile?.branch_id); }
    catch(err) { alert(err.message); }
  };
  const updateProgram = async (program, generatedSessions) => {
    try { await apiService.updateProgram(supabaseClient, withBranch(program), generatedSessions); await refreshData(profile?.branch_id); }
    catch(err) { alert(err.message); }
  };
  const deleteProgram = async (id) => {
    try { await apiService.deleteProgram(supabaseClient, id); await refreshData(profile?.branch_id); }
    catch(err) { alert(err.message); }
  };
  const addSession = async (session) => {
    try { await apiService.createSession(supabaseClient, withBranch(session)); await refreshData(profile?.branch_id); }
    catch(err) { alert(err.message); }
  };
  const updateSession = async (session) => {
    try { await apiService.updateSession(supabaseClient, session); await refreshData(profile?.branch_id); }
    catch(err) { alert(err.message); }
  };
  const deleteSession = async (id) => {
    try { await apiService.deleteSession(supabaseClient, id); await refreshData(profile?.branch_id); }
    catch(err) { alert(err.message); }
  };
  const addTeacher = async (teacher) => {
    try { await apiService.createTeacher(supabaseClient, withBranch(teacher)); await refreshData(profile?.branch_id); }
    catch(err) { alert(err.message); }
  };
  const updateTeacher = async (teacher) => {
    try { await apiService.updateTeacher(supabaseClient, teacher); await refreshData(profile?.branch_id); }
    catch(err) { alert(err.message); }
  };
  const deleteTeacher = async (id) => {
    try { await apiService.deleteTeacher(supabaseClient, id); await refreshData(profile?.branch_id); }
    catch(err) { alert(err.message); }
  };
  const addClassroom = async (classroom) => {
    try { await apiService.createClassroom(supabaseClient, withBranch(classroom)); await refreshData(profile?.branch_id); }
    catch(err) { alert(err.message); }
  };
  const updateClassroom = async (classroom) => {
    try { await apiService.updateClassroom(supabaseClient, classroom); await refreshData(profile?.branch_id); }
    catch(err) { alert(err.message); }
  };
  const deleteClassroom = async (id) => {
    try { await apiService.deleteClassroom(supabaseClient, id); await refreshData(profile?.branch_id); }
    catch(err) { alert(err.message); }
  };
  const addBranch = async (branch) => {
    try { await apiService.createBranch(supabaseClient, branch); await refreshData(profile?.branch_id); }
    catch(err) { alert(err.message); }
  }
  const signOut = async () => { if(supabaseClient) await supabaseClient.auth.signOut(); };

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
        <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-200 max-w-lg w-full">
          <div className="bg-red-50 p-4 rounded-full w-fit mx-auto mb-4"><ShieldAlert className="text-red-500" size={32} /></div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Setup Required</h2>
          <p className="text-gray-500 font-medium mb-6">The application is missing Supabase credentials.</p>
        </div>
      </div>
    );
  }

  if (!libLoaded || isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 space-y-4">
        {globalError ? (
          <><AlertTriangle className="text-red-600" size={48} /><div className="text-red-600 font-medium text-lg tracking-wide">{globalError}</div></>
        ) : (
          <><Loader2 className="text-blue-600 animate-spin" size={48} /><div className="text-gray-600 font-medium text-lg tracking-wide">Connecting to System...</div></>
        )}
      </div>
    );
  }

  return (
    <StoreContext.Provider value={{
      supabaseClient, user, profile, teachers, classrooms, programs, sessions, branches, globalError,
      saveProgram, updateProgram, deleteProgram, generateProgramSessions,
      addSession, updateSession, deleteSession,
      addTeacher, updateTeacher, deleteTeacher,
      addClassroom, updateClassroom, deleteClassroom,
      addBranch, switchBranch, assignManagerToBranch,
      findConflicts, signOut
    }}>
      {children}
    </StoreContext.Provider>
  );
};

// --- SHARED UI COMPONENTS ---
const Badge = ({ children, color = 'blue' }) => {
  const colors = {
    blue: 'bg-blue-100 text-blue-800 border-blue-200',
    purple: 'bg-purple-100 text-purple-800 border-purple-200',
    red: 'bg-red-100 text-red-800 border-red-200',
    orange: 'bg-orange-100 text-orange-800 border-orange-200',
    green: 'bg-green-100 text-green-800 border-green-200',
    gray: 'bg-gray-100 text-gray-800 border-gray-200',
    indigo: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    teal: 'bg-teal-100 text-teal-800 border-teal-200',
    cyan: 'bg-cyan-100 text-cyan-800 border-cyan-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
};

const getSessionColor = (type) => {
  if (type?.includes('batch')) return 'blue';
  if (type?.includes('club')) return 'purple';
  if (type === 'mock_test' || type === 'test') return 'indigo';
  if (type === 'partial_reading') return 'teal';
  if (type === 'partial_writing') return 'cyan';
  if (type === 'partial_speaking') return 'amber';
  return 'orange';
};

const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="flex justify-between items-center p-6 border-b sticky top-0 bg-white z-10 shrink-0">
          <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 p-1 rounded-full hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

// --- AUTH VIEW ---
const LoginView = () => {
  const { supabaseClient } = useContext(StoreContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!supabaseClient) return;
    setLoading(true); setError(null);
    const { error: authError } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (authError) setError(authError.message || "Failed to authenticate.");
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-xl shadow-sm border border-gray-100">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center">
            <GraduationCap size={36} />
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900 tracking-tight">HEXA'S ERP</h2>
          <p className="mt-2 text-sm text-gray-500 font-medium">Invite-Only Access</p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2">
              <AlertTriangle size={18} className="shrink-0" /><span>{error}</span>
            </div>
          )}
          <div className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-3 text-gray-400" size={20} />
              <input required type="email" placeholder="Work Email" className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white sm:text-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-gray-400" size={20} />
              <input required type="password" placeholder="Branch Password" className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white sm:text-sm" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>
          <button type="submit" disabled={loading} className="group relative w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none transition-colors disabled:opacity-50">
            {loading ? <Loader2 className="animate-spin" size={18} /> : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
};

// --- VIEWS ---

const SuperAdminDashboard = () => {
  const { branches, addBranch, assignManagerToBranch } = useContext(StoreContext);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', location: '' });
  const [isSaving, setIsSaving] = useState(false);
  
  const [managerForm, setManagerForm] = useState({ email: '', password: '', branch_id: '' });

  const handleAddBranchSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    await addBranch(formData);
    setIsSaving(false);
    setIsModalOpen(false);
    setFormData({ name: '', location: '' });
  };

  const handleAssignManagerSubmit = async (e) => {
    e.preventDefault();
    await assignManagerToBranch(managerForm.email, managerForm.branch_id);
    setManagerForm({ email: '', password: '', branch_id: '' });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Global Administration</h1>
          <p className="text-gray-500 mt-1">Manage global infrastructure and branch tenants.</p>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium transition-colors">
          <Plus size={20} /> Add Branch
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-blue-100 text-blue-600 rounded-lg"><Building2 size={24} /></div>
          <div>
            <p className="text-sm font-medium text-gray-500">Active Branches</p>
            <h3 className="text-2xl font-bold text-gray-900">{branches.length}</h3>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-800">Assign Branch Manager</h2>
        </div>
        <div className="p-6">
          <div className="bg-blue-50 text-blue-800 p-4 rounded-lg mb-6 text-sm flex items-start gap-3">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <div>
              <strong className="block mb-1">To create a manager securely:</strong>
              <ol className="list-decimal ml-4 space-y-1">
                <li>Add them in the Supabase Auth Dashboard.</li>
                <li>Use this form to link their email to a specific Branch.</li>
              </ol>
            </div>
          </div>
          
          <form onSubmit={handleAssignManagerSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Manager Email</label>
              <input required type="email" value={managerForm.email} onChange={e => setManagerForm({...managerForm, email: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm" placeholder="manager@branch.com" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Password</label>
              <input type="password" value={managerForm.password} onChange={e => setManagerForm({...managerForm, password: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-gray-50 text-sm" placeholder="Set in Supabase Auth" disabled title="Password must be set via Supabase Dashboard" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Assign to Branch</label>
              <select required value={managerForm.branch_id} onChange={e => setManagerForm({...managerForm, branch_id: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm">
                <option value="">Select Branch...</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <button type="submit" className="w-full px-4 py-2 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 transition-colors text-sm">
                Link Manager
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-800">Branch Directory</h2>
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-100 text-xs uppercase text-gray-500 font-semibold">
              <th className="p-4">Branch ID</th>
              <th className="p-4">Name</th>
              <th className="p-4">Location</th>
              <th className="p-4">Date Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {branches.map(branch => (
              <tr key={branch.id} className="hover:bg-gray-50 transition-colors">
                <td className="p-4 text-xs font-mono text-gray-400">{branch.id}</td>
                <td className="p-4 font-semibold text-gray-900">{branch.name}</td>
                <td className="p-4 text-sm text-gray-600">{branch.location || 'N/A'}</td>
                <td className="p-4 text-sm text-gray-600">
                  {new Date(branch.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {branches.length === 0 && (
              <tr><td colSpan="4" className="p-8 text-center text-gray-500">No branches configured.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Register New Branch">
        <form onSubmit={handleAddBranchSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch Name</label>
            <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" placeholder="e.g., Downtown Campus" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input required type="text" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" placeholder="e.g., 123 Main St, Sector 4" />
          </div>
          <div className="pt-4 flex justify-end gap-3 border-t">
            <button type="button" onClick={() => setIsModalOpen(false)} disabled={isSaving} className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={isSaving} className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">{isSaving ? 'Registering...' : 'Add Branch'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

const DashboardView = () => {
  const { sessions, teachers } = useContext(StoreContext);
  const todaysSessions = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    return (sessions || []).filter(s => new Date(s.start_time) >= today && new Date(s.start_time) < tomorrow)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }, [sessions]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Institute Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 text-blue-600 rounded-lg"><CalendarDays size={24} /></div>
            <div>
              <p className="text-sm font-medium text-gray-500">Today's Sessions</p>
              <h3 className="text-2xl font-bold text-gray-900">{todaysSessions.length}</h3>
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-100 text-purple-600 rounded-lg"><Users size={24} /></div>
            <div>
              <p className="text-sm font-medium text-gray-500">Active Teachers</p>
              <h3 className="text-2xl font-bold text-gray-900">{(teachers || []).length}</h3>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100"><h2 className="text-lg font-semibold text-gray-800">Today's Schedule</h2></div>
        <div className="p-0">
          {todaysSessions.length === 0 ? (
            <p className="p-6 text-gray-500 text-center">No sessions scheduled for today.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {todaysSessions.map(session => (
                <li key={session.id} className="p-4 hover:bg-gray-50 transition-colors flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900">{session.title}</h4>
                    <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                      <Clock size={14} /> {formatTime(session.start_time)} - {formatTime(session.end_time)}
                    </p>
                  </div>
                  <Badge color={getSessionColor(session.type)}>{(session.type || '').replace(/_/g, ' ').toUpperCase()}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

const CalendarView = () => {
  const { sessions, classrooms } = useContext(StoreContext);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [selectedClassroom, setSelectedClassroom] = useState('');

  const { weekStart, weekEnd, weekDays, weekSessions } = useMemo(() => {
    const range = getWeekRange(currentWeek);
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(range.start); d.setDate(d.getDate() + i); return d; });
    const filteredSessions = (sessions || []).filter(s => {
      const start = new Date(s.start_time);
      const inRange = start >= range.start && start <= range.end;
      const matchesRoom = selectedClassroom ? s.assigned_classroom === selectedClassroom : true;
      return inRange && matchesRoom;
    });
    return { weekStart: range.start, weekEnd: range.end, weekDays: days, weekSessions: filteredSessions };
  }, [currentWeek, sessions, selectedClassroom]);

  const hours = Array.from({ length: 14 }, (_, i) => i + 8); 

  const handlePrevWeek = () => { const d = new Date(currentWeek); d.setDate(d.getDate() - 7); setCurrentWeek(d); };
  const handleNextWeek = () => { const d = new Date(currentWeek); d.setDate(d.getDate() + 7); setCurrentWeek(d); };

  const getTypeColor = (type) => {
    switch (type) {
      case 'batch_session': return 'bg-blue-100 border-blue-300 text-blue-800';
      case 'club_session': return 'bg-purple-100 border-purple-300 text-purple-800';
      case 'test': case 'mock_test': return 'bg-indigo-100 border-indigo-300 text-indigo-800';
      case 'partial_reading': return 'bg-teal-100 border-teal-300 text-teal-800';
      case 'partial_writing': return 'bg-cyan-100 border-cyan-300 text-cyan-800';
      case 'partial_speaking': return 'bg-amber-100 border-amber-300 text-amber-800';
      default: return 'bg-orange-100 border-orange-300 text-orange-800';
    }
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-4 border-b flex justify-between items-center bg-gray-50">
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <CalendarDays size={20} className="text-blue-600" />
          {weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </h2>
        <div className="flex gap-2 items-center">
          <select value={selectedClassroom} onChange={(e) => setSelectedClassroom(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All Rooms</option>
            {classrooms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={handlePrevWeek} className="px-3 py-1.5 bg-white border rounded-md hover:bg-gray-50 text-sm font-medium">Prev Week</button>
          <button onClick={() => setCurrentWeek(new Date())} className="px-3 py-1.5 bg-white border rounded-md hover:bg-gray-50 text-sm font-medium">Today</button>
          <button onClick={handleNextWeek} className="px-3 py-1.5 bg-white border rounded-md hover:bg-gray-50 text-sm font-medium">Next Week</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto flex">
        <div className="w-16 flex-shrink-0 border-r bg-white relative">
          <div className="h-10 border-b bg-gray-50 sticky top-0 z-20"></div>
          {hours.map(hour => (
            <div key={hour} className="h-16 border-b text-xs text-gray-400 text-right pr-2 pt-1 font-medium">
              {hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`}
            </div>
          ))}
        </div>
        <div className="flex-1 grid grid-cols-7 min-w-[800px] relative">
          {weekDays.map((day, i) => (
            <div key={i} className="border-r relative">
              <div className="h-10 border-b flex flex-col items-center justify-center bg-gray-50 sticky top-0 z-10">
                <span className="text-xs font-semibold text-gray-500 uppercase">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                <span className={`text-sm font-bold ${day.toDateString() === new Date().toDateString() ? 'text-blue-600' : 'text-gray-900'}`}>{day.getDate()}</span>
              </div>
              <div className="relative" style={{ height: `${hours.length * 4}rem` }}>
                {hours.map(hour => <div key={hour} className={`h-16 border-b border-gray-100 ${selectedClassroom ? 'hover:bg-green-50 cursor-pointer transition-colors' : ''}`}></div>)}
                {weekSessions.filter(s => new Date(s.start_time).toDateString() === day.toDateString()).map(session => {
                  const start = new Date(session.start_time);
                  const end = new Date(session.end_time);
                  const startMinutesFrom8 = (start.getHours() - 8) * 60 + start.getMinutes();
                  const durationMinutes = (end - start) / (1000 * 60);
                  const topPos = (startMinutesFrom8 / 60) * 4; 
                  const heightPos = (durationMinutes / 60) * 4; 
                  const roomName = classrooms.find(c => c.id === session.assigned_classroom)?.name || 'TBA';
                  return (
                    <div key={session.id} className={`absolute left-1 right-1 rounded-md border p-1.5 shadow-sm overflow-hidden text-xs leading-tight transition-all hover:z-20 hover:shadow-md ${getTypeColor(session.type)}`} style={{ top: `${topPos}rem`, height: `${heightPos}rem`, zIndex: 10 }} title={`${session.title}\n${formatTime(start)} - ${formatTime(end)}`}>
                      <div className="font-semibold truncate">{session.title}</div>
                      <div className="opacity-80 mt-0.5 truncate">{formatTime(start)} - {formatTime(end)}</div>
                      {heightPos >= 3 && <div className="mt-1 opacity-75 truncate flex items-center gap-1"><MapPin size={10}/>{roomName}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const DailyRoomView = () => {
  const { sessions, classrooms, teachers } = useContext(StoreContext);
  const [currentDate, setCurrentDate] = useState(new Date());
  const hours = Array.from({ length: 14 }, (_, i) => i + 8); 

  const resizeRef = useRef({ index: -1, startX: 0, startWidth: 0 });
  const [columnWidths, setColumnWidths] = useState([]);

  useEffect(() => {
    setColumnWidths(Array(classrooms.length).fill(250));
  }, [classrooms.length]);

  const handleMouseMove = useCallback((e) => {
    if (resizeRef.current.index === -1) return;
    const { index, startX, startWidth } = resizeRef.current;
    const diff = e.clientX - startX;
    const newWidth = Math.max(150, startWidth + diff);
    setColumnWidths(prev => {
      const next = [...prev];
      next[index] = newWidth;
      return next;
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    resizeRef.current.index = -1;
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  const handleMouseDown = (index, e) => {
    e.preventDefault();
    resizeRef.current = { index, startX: e.clientX, startWidth: columnWidths[index] };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };
  }, [handleMouseMove, handleMouseUp]);

  const handlePrevDay = () => { const d = new Date(currentDate); d.setDate(d.getDate() - 1); setCurrentDate(d); };
  const handleNextDay = () => { const d = new Date(currentDate); d.setDate(d.getDate() + 1); setCurrentDate(d); };

  const daySessions = useMemo(() => {
    const startOfDay = new Date(currentDate); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(currentDate); endOfDay.setHours(23, 59, 59, 999);
    return (sessions || []).filter(s => {
      const start = new Date(s.start_time);
      return start >= startOfDay && start <= endOfDay;
    });
  }, [currentDate, sessions]);

  const getTypeColor = (type) => {
    switch (type) {
      case 'batch_session': return 'bg-blue-100 border-blue-300 text-blue-800';
      case 'club_session': return 'bg-purple-100 border-purple-300 text-purple-800';
      case 'test': case 'mock_test': return 'bg-indigo-100 border-indigo-300 text-indigo-800';
      case 'partial_reading': return 'bg-teal-100 border-teal-300 text-teal-800';
      case 'partial_writing': return 'bg-cyan-100 border-cyan-300 text-cyan-800';
      case 'partial_speaking': return 'bg-amber-100 border-amber-300 text-amber-800';
      default: return 'bg-orange-100 border-orange-300 text-orange-800';
    }
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-4 border-b flex justify-between items-center bg-gray-50">
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <Map size={20} className="text-blue-600" />
          {currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </h2>
        <div className="flex gap-2 items-center">
          <input type="date" value={[currentDate.getFullYear(), String(currentDate.getMonth() + 1).padStart(2, '0'), String(currentDate.getDate()).padStart(2, '0')].join('-')} onChange={(e) => { if (e.target.value) { const [y, m, d] = e.target.value.split('-'); setCurrentDate(new Date(y, m - 1, d)); } }} className="px-2 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <button onClick={handlePrevDay} className="px-3 py-1.5 bg-white border rounded-md hover:bg-gray-50 text-sm font-medium">Prev Day</button>
          <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 bg-white border rounded-md hover:bg-gray-50 text-sm font-medium">Today</button>
          <button onClick={handleNextDay} className="px-3 py-1.5 bg-white border rounded-md hover:bg-gray-50 text-sm font-medium">Next Day</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto flex">
        <div className="w-16 flex-shrink-0 border-r bg-white relative">
          <div className="h-10 border-b bg-gray-50 sticky top-0 z-20"></div>
          {hours.map(hour => (
            <div key={hour} className="h-16 border-b text-xs text-gray-400 text-right pr-2 pt-1 font-medium">
              {hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`}
            </div>
          ))}
        </div>
        <div className="flex-1 grid min-w-[800px] relative" style={{ gridTemplateColumns: columnWidths.length === classrooms.length ? columnWidths.map(w => w + 'px').join(' ') : `repeat(${classrooms.length}, minmax(0, 1fr))` }}>
          {classrooms.map((classroom, i) => (
            <div key={classroom.id} className="border-r relative">
              <div className="h-10 border-b flex flex-col items-center justify-center bg-gray-50 sticky top-0 z-10 relative">
                <span className="text-sm font-bold text-gray-900 truncate px-2">{classroom.name}</span>
                <span className="text-xs font-semibold text-gray-500">Cap: {classroom.capacity}</span>
                <div 
                  className="absolute right-0 top-0 w-2 h-full cursor-col-resize hover:bg-blue-500 z-20 transition-colors"
                  onMouseDown={(e) => handleMouseDown(i, e)}
                />
              </div>
              <div className="relative" style={{ height: `${hours.length * 4}rem` }}>
                {hours.map(hour => <div key={hour} className="h-16 border-b border-gray-100"></div>)}
                {daySessions.filter(s => s.assigned_classroom === classroom.id).map(session => {
                  const start = new Date(session.start_time);
                  const end = new Date(session.end_time);
                  const startMinutesFrom8 = (start.getHours() - 8) * 60 + start.getMinutes();
                  const durationMinutes = (end - start) / (1000 * 60);
                  const topPos = (startMinutesFrom8 / 60) * 4; 
                  const heightPos = (durationMinutes / 60) * 4; 
                  return (
                    <div key={session.id} className={`absolute left-1 right-1 rounded-md border p-1.5 shadow-sm overflow-hidden text-xs leading-tight transition-all hover:z-20 hover:shadow-md ${getTypeColor(session.type)}`} style={{ top: `${topPos}rem`, height: `${heightPos}rem`, zIndex: 10 }} title={`${session.title}\n${formatTime(start)} - ${formatTime(end)}`}>
                      <div className="font-semibold truncate">{session.title}</div>
                      <div className="opacity-80 mt-0.5 truncate">{formatTime(start)} - {formatTime(end)}</div>
                      {heightPos >= 3 && session.assigned_teachers && session.assigned_teachers.length > 0 && (
                        <div className="mt-1 opacity-75 truncate flex items-center gap-1">
                          <Users size={10}/> {(session.assigned_teachers||[]).map(tid => teachers.find(t=>t.id===tid)?.name.split(' ')[0]).join(', ')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const TeacherScheduleView = () => {
  const { sessions, classrooms, teachers } = useContext(StoreContext);
  const [mode, setMode] = useState('daily'); 
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedTeacherId, setSelectedTeacherId] = useState('');

  useEffect(() => {
    if (!selectedTeacherId && teachers.length > 0) setSelectedTeacherId(teachers[0].id);
  }, [teachers, selectedTeacherId]);

  const hours = Array.from({ length: 14 }, (_, i) => i + 8); 

  const handlePrev = () => { const d = new Date(currentDate); d.setDate(d.getDate() - (mode === 'weekly' ? 7 : 1)); setCurrentDate(d); };
  const handleNext = () => { const d = new Date(currentDate); d.setDate(d.getDate() + (mode === 'weekly' ? 7 : 1)); setCurrentDate(d); };

  const getTypeColor = (type) => {
    switch (type) {
      case 'batch_session': return 'bg-blue-100 border-blue-300 text-blue-800';
      case 'club_session': return 'bg-purple-100 border-purple-300 text-purple-800';
      case 'test': case 'mock_test': return 'bg-indigo-100 border-indigo-300 text-indigo-800';
      case 'partial_reading': return 'bg-teal-100 border-teal-300 text-teal-800';
      case 'partial_writing': return 'bg-cyan-100 border-cyan-300 text-cyan-800';
      case 'partial_speaking': return 'bg-amber-100 border-amber-300 text-amber-800';
      default: return 'bg-orange-100 border-orange-300 text-orange-800';
    }
  };

  const daySessions = useMemo(() => {
    if (mode !== 'daily') return [];
    const startOfDay = new Date(currentDate); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(currentDate); endOfDay.setHours(23, 59, 59, 999);
    return (sessions || []).filter(s => {
      const start = new Date(s.start_time);
      return start >= startOfDay && start <= endOfDay;
    });
  }, [currentDate, sessions, mode]);

  const { weekStart, weekEnd, weekDays, weekSessions } = useMemo(() => {
    if (mode !== 'weekly') return { weekDays: [], weekSessions: [] };
    const range = getWeekRange(currentDate);
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(range.start); d.setDate(d.getDate() + i); return d; });
    const filteredSessions = (sessions || []).filter(s => {
      const start = new Date(s.start_time);
      const inRange = start >= range.start && start <= range.end;
      const forTeacher = (s.assigned_teachers || []).includes(selectedTeacherId);
      return inRange && forTeacher;
    });
    return { weekStart: range.start, weekEnd: range.end, weekDays: days, weekSessions: filteredSessions };
  }, [currentDate, sessions, selectedTeacherId, mode]);

  const currentCols = mode === 'daily' ? teachers.length : weekDays.length;
  const resizeRef = useRef({ index: -1, startX: 0, startWidth: 0 });
  const [columnWidths, setColumnWidths] = useState([]);

  useEffect(() => {
    setColumnWidths(Array(currentCols).fill(250));
  }, [currentCols, mode]);

  const handleMouseMove = useCallback((e) => {
    if (resizeRef.current.index === -1) return;
    const { index, startX, startWidth } = resizeRef.current;
    const diff = e.clientX - startX;
    const newWidth = Math.max(150, startWidth + diff);
    setColumnWidths(prev => {
      const next = [...prev];
      next[index] = newWidth;
      return next;
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    resizeRef.current.index = -1;
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  const handleMouseDown = (index, e) => {
    e.preventDefault();
    resizeRef.current = { index, startX: e.clientX, startWidth: columnWidths[index] };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <div className="h-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-4 border-b flex justify-between items-center bg-gray-50 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2"><ClipboardList size={20} className="text-blue-600" /> Teacher Schedule</h2>
          <div className="flex bg-white rounded-lg border border-gray-200 p-1">
            <button onClick={() => setMode('daily')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === 'daily' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>Daily Overview</button>
            <button onClick={() => setMode('weekly')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === 'weekly' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>Weekly Individual</button>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {mode === 'weekly' && (
            <select value={selectedTeacherId} onChange={(e) => setSelectedTeacherId(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="" disabled>Select Teacher...</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {mode === 'daily' ? (
            <input type="date" value={[currentDate.getFullYear(), String(currentDate.getMonth() + 1).padStart(2, '0'), String(currentDate.getDate()).padStart(2, '0')].join('-')} onChange={(e) => { if (e.target.value) { const [y, m, d] = e.target.value.split('-'); setCurrentDate(new Date(y, m - 1, d)); } }} className="px-2 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          ) : (
             <span className="text-sm font-medium text-gray-600 mr-2">Week of {weekStart?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          )}
          <button onClick={handlePrev} className="px-3 py-1.5 bg-white border rounded-md hover:bg-gray-50 text-sm font-medium">Prev</button>
          <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 bg-white border rounded-md hover:bg-gray-50 text-sm font-medium">Today</button>
          <button onClick={handleNext} className="px-3 py-1.5 bg-white border rounded-md hover:bg-gray-50 text-sm font-medium">Next</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto flex">
        <div className="w-16 flex-shrink-0 border-r bg-white relative">
          <div className="h-10 border-b bg-gray-50 sticky top-0 z-20"></div>
          {hours.map(hour => (
            <div key={hour} className="h-16 border-b text-xs text-gray-400 text-right pr-2 pt-1 font-medium">{hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`}</div>
          ))}
        </div>
        {mode === 'daily' ? (
          <div className="flex-1 grid min-w-[800px] relative" style={{ gridTemplateColumns: columnWidths.length === teachers.length ? columnWidths.map(w => w + 'px').join(' ') : `repeat(${teachers.length}, minmax(0, 1fr))` }}>
            {teachers.map((teacher, i) => (
              <div key={teacher.id} className="border-r relative">
                <div className="h-10 border-b flex items-center justify-center bg-gray-50 sticky top-0 z-10 px-2 relative">
                  <span className="text-sm font-bold text-gray-900 truncate text-center" title={teacher.name}>{teacher.name}</span>
                  <div 
                    className="absolute right-0 top-0 w-2 h-full cursor-col-resize hover:bg-blue-500 z-20 transition-colors"
                    onMouseDown={(e) => handleMouseDown(i, e)}
                  />
                </div>
                <div className="relative" style={{ height: `${hours.length * 4}rem` }}>
                  {hours.map(hour => <div key={hour} className="h-16 border-b border-gray-100"></div>)}
                  {daySessions.filter(s => (s.assigned_teachers || []).includes(teacher.id)).map(session => {
                    const start = new Date(session.start_time);
                    const end = new Date(session.end_time);
                    const startMinutesFrom8 = (start.getHours() - 8) * 60 + start.getMinutes();
                    const durationMinutes = (end - start) / (1000 * 60);
                    const topPos = (startMinutesFrom8 / 60) * 4; 
                    const heightPos = (durationMinutes / 60) * 4; 
                    const roomName = classrooms.find(c => c.id === session.assigned_classroom)?.name || 'TBA';
                    return (
                      <div key={session.id} className={`absolute left-1 right-1 rounded-md border p-1.5 shadow-sm overflow-hidden text-xs leading-tight transition-all hover:z-20 hover:shadow-md ${getTypeColor(session.type)}`} style={{ top: `${topPos}rem`, height: `${heightPos}rem`, zIndex: 10 }} title={`${session.title}\n${formatTime(start)} - ${formatTime(end)}`}>
                        <div className="font-semibold truncate">{session.title}</div>
                        <div className="opacity-80 mt-0.5 truncate">{formatTime(start)} - {formatTime(end)}</div>
                        {heightPos >= 3 && <div className="mt-1 opacity-75 truncate flex items-center gap-1"><MapPin size={10}/>{roomName}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 grid min-w-[800px] relative" style={{ gridTemplateColumns: columnWidths.length === weekDays.length ? columnWidths.map(w => w + 'px').join(' ') : `repeat(${weekDays.length}, minmax(0, 1fr))` }}>
            {weekDays.map((day, i) => (
              <div key={i} className="border-r relative">
                <div className="h-10 border-b flex flex-col items-center justify-center bg-gray-50 sticky top-0 z-10 relative">
                  <span className="text-xs font-semibold text-gray-500 uppercase">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                  <span className={`text-sm font-bold ${day.toDateString() === new Date().toDateString() ? 'text-blue-600' : 'text-gray-900'}`}>{day.getDate()}</span>
                  <div 
                    className="absolute right-0 top-0 w-2 h-full cursor-col-resize hover:bg-blue-500 z-20 transition-colors"
                    onMouseDown={(e) => handleMouseDown(i, e)}
                  />
                </div>
                <div className="relative" style={{ height: `${hours.length * 4}rem` }}>
                  {hours.map(hour => <div key={hour} className="h-16 border-b border-gray-100"></div>)}
                  {weekSessions.filter(s => new Date(s.start_time).toDateString() === day.toDateString()).map(session => {
                    const start = new Date(session.start_time);
                    const end = new Date(session.end_time);
                    const startMinutesFrom8 = (start.getHours() - 8) * 60 + start.getMinutes();
                    const durationMinutes = (end - start) / (1000 * 60);
                    const topPos = (startMinutesFrom8 / 60) * 4; 
                    const heightPos = (durationMinutes / 60) * 4; 
                    const roomName = classrooms.find(c => c.id === session.assigned_classroom)?.name || 'TBA';
                    return (
                      <div key={session.id} className={`absolute left-1 right-1 rounded-md border p-1.5 shadow-sm overflow-hidden text-xs leading-tight transition-all hover:z-20 hover:shadow-md ${getTypeColor(session.type)}`} style={{ top: `${topPos}rem`, height: `${heightPos}rem`, zIndex: 10 }} title={`${session.title}\n${formatTime(start)} - ${formatTime(end)}`}>
                        <div className="font-semibold truncate">{session.title}</div>
                        <div className="opacity-80 mt-0.5 truncate">{formatTime(start)} - {formatTime(end)}</div>
                        {heightPos >= 3 && <div className="mt-1 opacity-75 truncate flex items-center gap-1"><MapPin size={10}/>{roomName}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const ProgramManager = () => {
  const { programs, classrooms, teachers, saveProgram, updateProgram, deleteProgram, generateProgramSessions, findConflicts } = useContext(StoreContext);
  const [isModalOpen, setModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingProgramId, setEditingProgramId] = useState(null);
  
  const [previewMode, setPreviewMode] = useState(false);
  const [previewData, setPreviewData] = useState({ valid: [], conflicting: [], program: {} });

  const defaultFormData = {
    name: '', type: 'batch',
    assigned_teachers: [], assigned_classroom: '',
    days_of_week: [],
    start_time: '09:00', end_time: '11:00',
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date(new Date().setMonth(new Date().getMonth() + 2)).toISOString().split('T')[0]
  };
  
  const [formData, setFormData] = useState(defaultFormData);
  const [liveConflicts, setLiveConflicts] = useState([]);

  useEffect(() => {
    if (!formData.start_date || !formData.start_time) return;
    const isAssessment = ['mock_test', 'partial_reading', 'partial_writing', 'partial_speaking'].includes(formData.type);
    if (formData.days_of_week.length > 0 && formData.assigned_classroom && (isAssessment || formData.assigned_teachers.length > 0)) {
      let checkDate = createDateFromTime(formData.start_date, formData.start_time);
      for(let i=0; i<7; i++) {
        if(formData.days_of_week.includes(checkDate.getDay())) break;
        checkDate.setDate(checkDate.getDate() + 1);
      }
      const dStr = checkDate.toISOString().split('T')[0];
      const sStart = createDateFromTime(dStr, formData.start_time);
      const sEnd = createDateFromTime(dStr, formData.end_time);
      const c = findConflicts(sStart.toISOString(), sEnd.toISOString(), formData.assigned_teachers, formData.assigned_classroom, null, editingProgramId);
      setLiveConflicts(c);
    } else {
      setLiveConflicts([]);
    }
  }, [formData, findConflicts, editingProgramId]);

  const toggleDay = (dayIndex) => {
    setFormData(prev => {
      const days = prev.days_of_week.includes(dayIndex) ? prev.days_of_week.filter(d => d !== dayIndex) : [...prev.days_of_week, dayIndex].sort();
      return { ...prev, days_of_week: days };
    });
  };

  const toggleTeacher = (teacherId) => {
    setFormData(prev => {
      let newTeachers = prev.assigned_teachers;
      if (newTeachers.includes(teacherId)) newTeachers = newTeachers.filter(id => id !== teacherId);
      else newTeachers = [...newTeachers, teacherId];
      return { ...prev, assigned_teachers: newTeachers };
    });
  };

  const handleSelectAllTeachers = () => {
    if (formData.assigned_teachers.length === teachers.length && teachers.length > 0) {
      setFormData(prev => ({ ...prev, assigned_teachers: [] }));
    } else {
      setFormData(prev => ({ ...prev, assigned_teachers: teachers.map(t => t.id) }));
    }
  };

  const handleEdit = (program) => {
    setEditingProgramId(program.id);
    setFormData({
      name: program.name, type: program.type, assigned_teachers: program.assigned_teachers || [],
      assigned_classroom: program.assigned_classroom, days_of_week: program.days_of_week || [],
      start_date: program.start_date, end_date: program.end_date, start_time: program.start_time, end_time: program.end_time
    });
    setPreviewMode(false); setModalOpen(true);
  };

  const handleCloseModal = () => {
    if (!isSaving) {
      setModalOpen(false); setPreviewMode(false); setEditingProgramId(null);
      setFormData(defaultFormData); setPreviewData({ valid: [], conflicting: [], program: {} });
    }
  };

  const handlePreview = (e) => {
    e.preventDefault();
    if (formData.days_of_week.length === 0) return alert('Select at least one day.');
    const isAssessment = ['mock_test', 'partial_reading', 'partial_writing', 'partial_speaking'].includes(formData.type);
    if (!isAssessment && formData.assigned_teachers.length === 0) return alert('Assign at least one teacher for batches or clubs.');
    if (!formData.assigned_classroom) return alert('Assign a classroom.');

    const programWithId = { ...formData, id: editingProgramId || generateId() }; // Fake ID for preview mapping
    const generated = generateProgramSessions(programWithId);
    const valid = []; const conflicting = [];

    generated.forEach(s => {
      const conflicts = findConflicts(s.start_time, s.end_time, s.assigned_teachers, s.assigned_classroom, null, editingProgramId);
      if (conflicts.length > 0) conflicting.push({ session: s, reasons: conflicts });
      else valid.push(s);
    });

    setPreviewData({ program: programWithId, valid, conflicting });
    setPreviewMode(true);
  };

  const handleConfirm = async (onlyValid) => {
    setIsSaving(true);
    let sessionsToSave = previewData.valid || [];
    let skippedCount = (previewData.conflicting || []).length;

    if (!onlyValid) {
      sessionsToSave = [...(previewData.valid || []), ...(previewData.conflicting || []).map(c => c.session)];
      skippedCount = 0;
    }

    if (editingProgramId) await updateProgram(previewData.program, sessionsToSave);
    else await saveProgram(previewData.program, sessionsToSave);
    
    setIsSaving(false);
    if (skippedCount > 0) alert(`${sessionsToSave.length} sessions saved, ${skippedCount} skipped due to conflicts.`);
    handleCloseModal();
  };

  const daysLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Recurring Programs</h1>
        <button onClick={() => { setEditingProgramId(null); setFormData(defaultFormData); setModalOpen(true); setPreviewMode(false); }} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium transition-colors">
          <Plus size={20} /> Create Program
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {(programs || []).map(program => (
          <div key={program.id} className="bg-white border rounded-xl p-6 shadow-sm relative group transition-colors hover:border-blue-200 hover:shadow-md">
            <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => handleEdit(program)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title="Edit Program"><Edit2 size={18} /></button>
              <button onClick={() => deleteProgram(program.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" title="Delete Program"><Trash2 size={18} /></button>
            </div>
            <Badge color={getSessionColor(program.type)}>{(program.type||'').replace(/_/g, ' ').toUpperCase()}</Badge>
            <h3 className="text-xl font-bold text-gray-900 mt-3 mb-1">{program.name}</h3>
            <p className="text-sm text-gray-500 mb-4">{program.start_date} to {program.end_date}</p>
            
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3 text-gray-700">
                <Clock size={16} className="mt-0.5 text-gray-400" />
                <div>
                  <p className="font-medium">{formatTime(createDateFromTime(program.start_date, program.start_time))} - {formatTime(createDateFromTime(program.start_date, program.end_time))}</p>
                  <div className="flex gap-1 mt-1">
                    {(program.days_of_week || []).map(d => <span key={d} className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-medium text-gray-600">{daysLabels[d]}</span>)}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 text-gray-700">
                <Users size={16} className="mt-0.5 text-gray-400" />
                <div>{(program.assigned_teachers || []).map(tid => <p key={tid}>{teachers.find(t => t.id === tid)?.name || 'Unknown'}</p>)}</div>
              </div>
              <div className="flex items-start gap-3 text-gray-700">
                <MapPin size={16} className="mt-0.5 text-gray-400" />
                <p>{classrooms.find(c => c.id === program.assigned_classroom)?.name || 'Unknown'}</p>
              </div>
            </div>
          </div>
        ))}
        {(programs || []).length === 0 && (
          <div className="col-span-full p-12 text-center text-gray-500 border-2 border-dashed rounded-xl">
            No recurring programs exist yet. Create one to auto-generate sessions.
          </div>
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={handleCloseModal} title={previewMode ? "Program Preview" : editingProgramId ? "Edit Program" : "Create New Program"}>
        {!previewMode ? (
          <form onSubmit={handlePreview} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Program Name</label>
                <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 p-2 border" placeholder="e.g., Weekend IELTS Batch 42" />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="w-full border-gray-300 rounded-lg p-2 border">
                  <option value="batch">Academic Batch</option><option value="club">Practice Club</option><option value="mock_test">Mock Test</option><option value="partial_reading">Reading Partial</option><option value="partial_writing">Writing Partial</option><option value="partial_speaking">Speaking Partial</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Classroom</label>
                <select required value={formData.assigned_classroom} onChange={e => setFormData({...formData, assigned_classroom: e.target.value})} className="w-full border-gray-300 rounded-lg p-2 border">
                  <option value="">Select Room...</option>
                  {classrooms.map(c => <option key={c.id} value={c.id}>{c.name} (Cap: {c.capacity})</option>)}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Days of the Week</label>
                <div className="flex gap-2">
                  {daysLabels.map((day, i) => (
                    <button key={i} type="button" onClick={() => toggleDay(i)} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${formData.days_of_week.includes(i) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input required type="date" value={formData.start_date} onChange={e => setFormData({...formData, start_date: e.target.value})} className="w-full p-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input required type="date" value={formData.end_date} onChange={e => setFormData({...formData, end_date: e.target.value})} className="w-full p-2 border rounded-lg" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Session Start Time</label>
                <input required type="time" value={formData.start_time} onChange={e => setFormData({...formData, start_time: e.target.value})} className="w-full p-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Session End Time</label>
                <input required type="time" value={formData.end_time} onChange={e => setFormData({...formData, end_time: e.target.value})} className="w-full p-2 border rounded-lg" />
              </div>

              <div className="col-span-2">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Assign Personnel
                    {['mock_test', 'partial_reading', 'partial_writing', 'partial_speaking'].includes(formData.type) && <span className="text-gray-400 font-normal italic ml-2">- Optional for Assessments</span>}
                  </label>
                  <button type="button" onClick={handleSelectAllTeachers} className="text-blue-600 text-xs hover:underline font-medium">
                    {formData.assigned_teachers.length === teachers.length && teachers.length > 0 ? 'Clear All' : 'Select All'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {teachers.map(t => (
                    <label key={t.id} className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" className="rounded text-blue-600 focus:ring-blue-500 mr-3 h-4 w-4" checked={formData.assigned_teachers.includes(t.id)} onChange={() => toggleTeacher(t.id)} />
                      <span className="text-sm font-medium text-gray-900">{t.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {liveConflicts.length > 0 && (
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg flex items-start gap-3">
                <AlertTriangle className="text-orange-500 shrink-0" size={20} />
                <div>
                  <h4 className="text-sm font-bold text-orange-800">Early Overlaps Detected</h4>
                  <ul className="text-xs text-orange-700 mt-1 list-disc list-inside">{liveConflicts.map((c, i) => <li key={i}>{c}</li>)}</ul>
                  <p className="text-xs text-orange-600 mt-2 font-medium">Full analysis will be shown on the next step.</p>
                </div>
              </div>
            )}

            <div className="pt-4 flex justify-end gap-3 border-t">
              <button type="button" onClick={handleCloseModal} className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg">Cancel</button>
              <button type="submit" className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700">Preview Generation</button>
            </div>
          </form>
        ) : (
          <div className="space-y-6">
            {previewData ? (
              <>
                <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <div className="text-center px-4">
                    <p className="text-sm text-gray-500 font-medium">Total Generated</p>
                    <p className="text-3xl font-bold text-gray-900">{(previewData?.valid?.length || 0) + (previewData?.conflicting?.length || 0)}</p>
                  </div>
                  <div className="w-px h-12 bg-gray-200"></div>
                  <div className="text-center px-4">
                    <p className="text-sm text-green-600 font-medium">Valid Sessions</p>
                    <p className="text-3xl font-bold text-green-600">{previewData?.valid?.length || 0}</p>
                  </div>
                  <div className="w-px h-12 bg-gray-200"></div>
                  <div className="text-center px-4">
                    <p className="text-sm text-red-600 font-medium">Conflicts Found</p>
                    <p className="text-3xl font-bold text-red-600">{previewData?.conflicting?.length || 0}</p>
                  </div>
                </div>

                <div className="max-h-96 overflow-y-auto space-y-6 pr-2">
                  {(previewData?.conflicting || []).length > 0 && (
                    <div>
                      <h4 className="font-bold text-red-800 mb-3 flex items-center gap-2"><AlertTriangle size={18} /> Conflicting Sessions</h4>
                      <ul className="space-y-3">
                        {previewData.conflicting.map((c, i) => (
                          <li key={i} className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
                            <div className="font-semibold text-red-900 mb-1">
                              {new Date(c.session.start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} 
                              <span className="ml-2 px-2 py-0.5 bg-red-100 rounded text-xs">{formatTime(c.session.start_time)} - {formatTime(c.session.end_time)}</span>
                            </div>
                            <ul className="list-disc list-inside text-red-700 mt-1 text-xs">
                              {(c.reasons || []).map((r, j) => <li key={j}>{r}</li>)}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(previewData?.valid || []).length > 0 && (
                    <div>
                      <h4 className="font-bold text-green-800 mb-3 flex items-center gap-2"><Check size={18} /> Valid Sessions Preview</h4>
                      <ul className="grid grid-cols-2 gap-2">
                        {previewData.valid.map((s, i) => (
                          <li key={i} className="p-2 bg-green-50 border border-green-200 rounded-lg text-xs font-medium text-green-800">
                            {new Date(s.start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            <div className="text-green-600 font-normal mt-0.5">{formatTime(s.start_time)} - {formatTime(s.end_time)}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="pt-4 flex justify-between gap-3 border-t">
                  <button type="button" disabled={isSaving} onClick={() => setPreviewMode(false)} className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg disabled:opacity-50">Back to Edit</button>
                  <div className="flex gap-2">
                    <button type="button" disabled={isSaving} onClick={handleCloseModal} className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg disabled:opacity-50">Cancel</button>
                    {(previewData?.conflicting || []).length > 0 && (
                      <button onClick={() => handleConfirm(false)} disabled={isSaving} className="px-4 py-2 bg-red-100 text-red-700 font-medium rounded-lg hover:bg-red-200 disabled:opacity-50">Force Save All</button>
                    )}
                    <button 
                      onClick={() => handleConfirm(true)} 
                      disabled={(previewData?.valid || []).length === 0 || isSaving}
                      className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isSaving ? 'Saving...' : ((previewData?.conflicting || []).length > 0 ? 'Save Valid Only' : 'Confirm & Save')}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-10 text-center italic text-gray-500">Generating preview...</div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

const SessionManager = () => {
  const { sessions, classrooms, teachers, addSession, updateSession, deleteSession, findConflicts } = useContext(StoreContext);
  const [isModalOpen, setModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState(null);
  
  const defaultFormData = { title: '', type: 'mock_test', assigned_teachers: [], assigned_classroom: '', date: new Date().toISOString().split('T')[0], start_time: '14:00', end_time: '16:00' };
  const [formData, setFormData] = useState(defaultFormData);
  const [conflicts, setConflicts] = useState([]);

  useEffect(() => {
    const isAssessment = ['mock_test', 'partial_reading', 'partial_writing', 'partial_speaking', 'test'].includes(formData.type);
    if (formData.date && formData.assigned_classroom && (isAssessment || formData.assigned_teachers.length > 0)) {
      const sStart = createDateFromTime(formData.date, formData.start_time).toISOString();
      const sEnd = createDateFromTime(formData.date, formData.end_time).toISOString();
      setConflicts(findConflicts(sStart, sEnd, formData.assigned_teachers, formData.assigned_classroom, editingSessionId));
    } else {
      setConflicts([]);
    }
  }, [formData, findConflicts, editingSessionId]);

  const toggleTeacher = (teacherId) => {
    setFormData(prev => {
      let newTeachers = prev.assigned_teachers;
      if (newTeachers.includes(teacherId)) newTeachers = newTeachers.filter(id => id !== teacherId);
      else newTeachers = [...newTeachers, teacherId];
      return { ...prev, assigned_teachers: newTeachers };
    });
  };

  const handleSelectAllTeachers = () => {
    if (formData.assigned_teachers.length === teachers.length && teachers.length > 0) {
      setFormData(prev => ({ ...prev, assigned_teachers: [] }));
    } else {
      setFormData(prev => ({ ...prev, assigned_teachers: teachers.map(t => t.id) }));
    }
  };

  const formatTimeForInput = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  const handleEdit = (session) => {
    const startDate = new Date(session.start_time);
    const endDate = new Date(session.end_time);
    setEditingSessionId(session.id);
    setFormData({ title: session.title, type: session.type, assigned_teachers: session.assigned_teachers || [], assigned_classroom: session.assigned_classroom, date: startDate.toISOString().split('T')[0], start_time: formatTimeForInput(startDate), end_time: formatTimeForInput(endDate) });
    setModalOpen(true);
  };

  const handleCloseModal = () => { if (!isSaving) { setModalOpen(false); setEditingSessionId(null); setFormData(defaultFormData); } };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (conflicts.length > 0) return alert('Resolve conflicts before saving.');
    const isAssessment = ['mock_test', 'partial_reading', 'partial_writing', 'partial_speaking', 'test'].includes(formData.type);
    if (!isAssessment && formData.assigned_teachers.length === 0) return alert('Assign at least one teacher.');
    
    setIsSaving(true);
    const sessionPayload = { title: formData.title, type: formData.type, assigned_teachers: formData.assigned_teachers, assigned_classroom: formData.assigned_classroom, start_time: createDateFromTime(formData.date, formData.start_time).toISOString(), end_time: createDateFromTime(formData.date, formData.end_time).toISOString() };

    if (editingSessionId) await updateSession({ ...sessionPayload, id: editingSessionId, program_id: sessions.find(s => s.id === editingSessionId)?.program_id });
    else await addSession(sessionPayload);
    
    setIsSaving(false);
    handleCloseModal();
  };

  const adhocSessions = useMemo(() => (sessions || []).filter(s => !s.program_id).sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()), [sessions]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ad-Hoc Sessions</h1>
          <p className="text-gray-500 mt-1">Manage single occurrence events like Mock Tests or Staff Meetings.</p>
        </div>
        <button onClick={() => { setEditingSessionId(null); setFormData(defaultFormData); setModalOpen(true); }} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium transition-colors"><Plus size={20} /> Create Session</button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b text-xs uppercase text-gray-500 font-semibold">
              <th className="p-4">Title & Type</th><th className="p-4">Date & Time</th><th className="p-4">Teachers</th><th className="p-4">Classroom</th><th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {adhocSessions.map(session => {
              const start = new Date(session.start_time);
              return (
                <tr key={session.id} className="hover:bg-gray-50 transition-colors group">
                  <td className="p-4">
                    <p className="font-medium text-gray-900">{session.title}</p>
                    <div className="mt-1"><Badge color={getSessionColor(session.type)}>{(session.type||'').replace(/_/g, ' ').toUpperCase()}</Badge></div>
                  </td>
                  <td className="p-4 text-sm text-gray-700">
                    <p className="font-medium">{start.toLocaleDateString()}</p>
                    <p className="text-gray-500">{formatTime(session.start_time)} - {formatTime(session.end_time)}</p>
                  </td>
                  <td className="p-4 text-sm text-gray-700">{(session.assigned_teachers||[]).map(tid => <div key={tid}>{teachers.find(t=>t.id===tid)?.name}</div>)}</td>
                  <td className="p-4 text-sm text-gray-700">{classrooms.find(c=>c.id === session.assigned_classroom)?.name}</td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEdit(session)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"><Edit2 size={18} /></button>
                      <button onClick={() => deleteSession(session.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={18} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {adhocSessions.length === 0 && <tr><td colSpan="5" className="p-8 text-center text-gray-500">No ad-hoc sessions scheduled.</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={handleCloseModal} title={editingSessionId ? "Edit Session" : "Create Ad-Hoc Session"}>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Session Title</label>
              <input required type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full p-2 border rounded-lg" placeholder="e.g., General Training Mock Test" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="w-full p-2 border rounded-lg">
                <option value="test">Generic Test</option><option value="mock_test">Full Mock Test</option><option value="partial_reading">Reading Partial</option><option value="partial_writing">Writing Partial</option><option value="partial_speaking">Speaking Partial</option><option value="meeting">Staff Meeting</option><option value="extra_class">Extra Class</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Classroom</label>
              <select required value={formData.assigned_classroom} onChange={e => setFormData({...formData, assigned_classroom: e.target.value})} className="w-full p-2 border rounded-lg">
                <option value="">Select Room...</option>{classrooms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input required type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full p-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
              <input required type="time" value={formData.start_time} onChange={e => setFormData({...formData, start_time: e.target.value})} className="w-full p-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
              <input required type="time" value={formData.end_time} onChange={e => setFormData({...formData, end_time: e.target.value})} className="w-full p-2 border rounded-lg" />
            </div>
            <div className="col-span-2">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-gray-700">Assign Personnel</label>
                <button type="button" onClick={handleSelectAllTeachers} className="text-blue-600 text-xs hover:underline font-medium">
                  {formData.assigned_teachers.length === teachers.length && teachers.length > 0 ? 'Clear All' : 'Select All'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {teachers.map(t => (
                  <label key={t.id} className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" className="rounded text-blue-600 focus:ring-blue-500 mr-3 h-4 w-4" checked={formData.assigned_teachers.includes(t.id)} onChange={() => toggleTeacher(t.id)} />
                    <span className="text-sm font-medium text-gray-900">{t.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          {conflicts.length > 0 && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertTriangle className="text-red-500 shrink-0" size={20} />
              <div>
                <h4 className="text-sm font-bold text-red-800">Cannot Save: Schedule Conflict</h4>
                <ul className="text-xs text-red-700 mt-1 list-disc list-inside">{conflicts.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </div>
            </div>
          )}
          <div className="pt-4 flex justify-end gap-3 border-t">
            <button type="button" onClick={handleCloseModal} disabled={isSaving} className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={conflicts.length > 0 || isSaving} className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">{isSaving ? 'Saving...' : editingSessionId ? 'Update Session' : 'Save Session'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

const ResourceManager = () => {
  const { teachers, classrooms, addTeacher, updateTeacher, deleteTeacher, addClassroom, updateClassroom, deleteClassroom } = useContext(StoreContext);
  const [isTeacherModalOpen, setTeacherModalOpen] = useState(false);
  const [isClassroomModalOpen, setClassroomModalOpen] = useState(false);
  const defaultTeacherForm = { id: null, name: '' };
  const [teacherForm, setTeacherForm] = useState(defaultTeacherForm);
  const defaultClassroomForm = { id: null, name: '', capacity: 20 };
  const [classroomForm, setClassroomForm] = useState(defaultClassroomForm);

  const handleTeacherSubmit = async (e) => {
    e.preventDefault();
    if (teacherForm.id) await updateTeacher(teacherForm); else await addTeacher(teacherForm);
    setTeacherModalOpen(false);
  };

  const handleClassroomSubmit = async (e) => {
    e.preventDefault();
    if (classroomForm.id) await updateClassroom(classroomForm); else await addClassroom(classroomForm);
    setClassroomModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Resource Management</h1>
        <p className="text-gray-500 mt-1">Manage teachers and classroom spaces.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-[calc(100vh-12rem)]">
          <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2"><Users size={20} className="text-blue-600" /> Teachers</h2>
            <button onClick={() => { setTeacherForm(defaultTeacherForm); setTeacherModalOpen(true); }} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-sm font-medium transition-colors"><Plus size={16} /> Add Teacher</button>
          </div>
          <div className="overflow-auto flex-1">
            <ul className="divide-y divide-gray-100">
              {teachers.map(teacher => (
                <li key={teacher.id} className="p-4 hover:bg-gray-50 flex items-center justify-between group transition-colors">
                  <div><h4 className="font-medium text-gray-900">{teacher.name}</h4></div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setTeacherForm(teacher); setTeacherModalOpen(true); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"><Edit2 size={16} /></button>
                    <button onClick={() => deleteTeacher(teacher.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={16} /></button>
                  </div>
                </li>
              ))}
              {teachers.length === 0 && <li className="p-8 text-center text-gray-500">No teachers found.</li>}
            </ul>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-[calc(100vh-12rem)]">
          <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2"><MapPin size={20} className="text-purple-600" /> Classrooms</h2>
            <button onClick={() => { setClassroomForm(defaultClassroomForm); setClassroomModalOpen(true); }} className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-sm font-medium transition-colors"><Plus size={16} /> Add Classroom</button>
          </div>
          <div className="overflow-auto flex-1">
            <ul className="divide-y divide-gray-100">
              {classrooms.map(classroom => (
                <li key={classroom.id} className="p-4 hover:bg-gray-50 flex items-center justify-between group transition-colors">
                  <div><h4 className="font-medium text-gray-900">{classroom.name}</h4><p className="text-sm text-gray-500 mt-0.5">Capacity: {classroom.capacity}</p></div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setClassroomForm(classroom); setClassroomModalOpen(true); }} className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-md transition-colors"><Edit2 size={16} /></button>
                    <button onClick={() => deleteClassroom(classroom.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={16} /></button>
                  </div>
                </li>
              ))}
              {classrooms.length === 0 && <li className="p-8 text-center text-gray-500">No classrooms found.</li>}
            </ul>
          </div>
        </div>
      </div>

      <Modal isOpen={isTeacherModalOpen} onClose={() => setTeacherModalOpen(false)} title={teacherForm.id ? "Edit Teacher" : "Add New Teacher"}>
        <form onSubmit={handleTeacherSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Teacher Name</label>
            <input required type="text" value={teacherForm.name} onChange={e => setTeacherForm({...teacherForm, name: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500" placeholder="e.g., Sarah Jenkins" />
          </div>
          <div className="pt-4 flex justify-end gap-3 border-t">
            <button type="button" onClick={() => setTeacherModalOpen(false)} className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700">Save Teacher</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isClassroomModalOpen} onClose={() => setClassroomModalOpen(false)} title={classroomForm.id ? "Edit Classroom" : "Add New Classroom"}>
        <form onSubmit={handleClassroomSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Classroom Name</label>
            <input required type="text" value={classroomForm.name} onChange={e => setClassroomForm({...classroomForm, name: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500" placeholder="e.g., Room A" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
            <input required type="number" min="1" max="500" value={classroomForm.capacity} onChange={e => setClassroomForm({...classroomForm, capacity: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500" />
          </div>
          <div className="pt-4 flex justify-end gap-3 border-t">
            <button type="button" onClick={() => setClassroomModalOpen(false)} className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" className="px-6 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700">Save Classroom</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
// --- END VIEWS ---

// --- APP SHELL WRAPPER ---
const AppShell = () => {
  const { user, profile, branches, switchBranch, signOut, globalError } = useContext(StoreContext);
  const [activeTab, setActiveTab] = useState('dashboard');

  if (!user) return <LoginView />;

  const baseNavigation = [
    { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
    { id: 'calendar', name: 'Weekly Calendar', icon: Calendar },
    { id: 'teacher-schedule', name: 'Teacher Schedules', icon: Briefcase },
    { id: 'daily-rooms', name: 'Daily Rooms', icon: Map },
    { id: 'programs', name: 'Programs', icon: BookOpen },
    { id: 'sessions', name: 'Ad-Hoc Sessions', icon: Clock },
    { id: 'resources', name: 'Resources', icon: Settings },
  ];

  const navigation = profile?.role === 'super_admin' 
    ? [...baseNavigation, { id: 'admin', name: 'Global Admin', icon: ShieldAlert }] 
    : baseNavigation;

  return (
    <div className="min-h-screen bg-gray-50/50 flex text-gray-900 font-sans">
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col z-40">
        <div className="h-16 flex items-center px-6 border-b border-gray-100 shrink-0">
          <GraduationCap className="text-red-600 mr-2" size={28} />
          <span className="text-lg font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-red-600 to-blue-800">
            HEXA'S ERP
          </span>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                  isActive 
                    ? (item.id === 'admin' ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-800')
                    : 'text-gray-600 hover:bg-gray-100 hover:text-blue-800'
                }`}
              >
                <Icon size={20} className={isActive ? (item.id === 'admin' ? 'text-red-800' : 'text-blue-800') : 'text-gray-400'} />
                {item.name}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-100 space-y-3 shrink-0">
          <div className={`bg-gradient-to-br ${profile?.role === 'super_admin' ? 'from-red-800 to-red-950 shadow-red-900/20' : 'from-blue-800 to-blue-950 shadow-blue-900/20'} rounded-xl p-4 text-white shadow-lg`}>
            <p className="text-xs font-semibold opacity-80 uppercase tracking-wider mb-2">Active Tenant</p>
            
            {profile?.role === 'super_admin' ? (
              <select 
                value={profile?.branch_id || ''} 
                onChange={(e) => switchBranch(e.target.value)}
                className="w-full bg-red-900/50 border border-red-700/50 text-white text-sm rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-red-400"
              >
                <option value="">Global View (All)</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                <p className="text-sm font-medium truncate">{profile?.branches?.name || 'Unknown Branch'}</p>
              </div>
            )}
            
            <p className="text-[10px] mt-2 opacity-60">Role: {(profile?.role || 'User').replace('_', ' ')}</p>
          </div>
          
          <button 
            onClick={signOut}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors border border-red-100"
          >
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-auto p-8 relative">
        {globalError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded shadow-lg font-medium text-sm flex items-center gap-2 z-50">
            <AlertTriangle size={16} />
            {globalError}
          </div>
        )}
        
        <div className="max-w-6xl mx-auto h-full">
           {activeTab === 'dashboard' && <DashboardView />}
           {activeTab === 'calendar' && <CalendarView />}
           {activeTab === 'teacher-schedule' && <TeacherScheduleView />}
           {activeTab === 'daily-rooms' && <DailyRoomView />}
           {activeTab === 'programs' && <ProgramManager />}
           {activeTab === 'sessions' && <SessionManager />}
           {activeTab === 'resources' && <ResourceManager />}
           {activeTab === 'admin' && profile?.role === 'super_admin' && <SuperAdminDashboard />}
        </div>
      </main>
    </div>
  );
};

export default function App() {
  return (
    <StoreProvider>
      <AppShell />
    </StoreProvider>
  );
}