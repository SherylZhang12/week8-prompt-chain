'use client';
import {useEffect,useState} from 'react';

export function Theme() {
  const [theme,setTheme] = useState('system');
  useEffect(() => {
    const saved = localStorage.getItem('foodfolio-lab-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.dataset.theme = saved;
      setTheme(saved);
    }
  },[]);
  return <label className="theme">Theme <select value={theme} onChange={event=>{
    const value = event.target.value;
    document.documentElement.dataset.theme = value;
    localStorage.setItem('foodfolio-lab-theme',value);
    setTheme(value);
  }}>
    <option value="system">System default</option><option value="light">Light</option><option value="dark">Dark</option>
  </select></label>;
}
