import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { toast } from 'sonner';
import { Heart, Eye, EyeOff } from 'lucide-react';

export default function CRMLoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await login(email, password);
      if (res.user.role !== 'CRM_STAFF' && res.user.role !== 'ADMIN') {
        toast.error('This portal is for CRM staff only');
        return;
      }
      navigate('/crm');
      toast.success('Welcome to CRM Portal');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0F172A] p-8">
      <div className="absolute inset-0 bg-gradient-to-br from-rose-900/20 via-transparent to-sky-900/20" />
      <div className="relative z-10 w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-12 h-12 bg-rose-500 rounded-sm flex items-center justify-center shadow-lg shadow-rose-500/20">
            <Heart className="w-6 h-6 text-white" />
          </div>
        </div>
        <h1 className="text-3xl font-heading font-bold text-white text-center mb-1 tracking-tight">CRM Portal</h1>
        <p className="text-sm text-slate-400 font-body text-center mb-8">Sahakar Hyper Pharmacy Network</p>

        <Card className="border-slate-700 bg-slate-800/50 backdrop-blur-sm shadow-xl rounded-sm">
          <CardHeader className="pb-4">
            <CardTitle className="font-heading text-lg text-white">Sign in to CRM</CardTitle>
            <CardDescription className="font-body text-sm text-slate-400">Patient lifecycle management portal</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label className="font-body text-xs text-slate-300 uppercase tracking-wider">Email</Label>
                <Input data-testid="crm-login-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="crm@sahakar.com" required className="font-body rounded-sm bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500" />
              </div>
              <div className="space-y-2">
                <Label className="font-body text-xs text-slate-300 uppercase tracking-wider">Password</Label>
                <div className="relative">
                  <Input data-testid="crm-login-password" type={showPass ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)} placeholder="Enter password" required
                    className="font-body pr-10 rounded-sm bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500" />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" data-testid="crm-login-submit" className="w-full bg-rose-500 hover:bg-rose-600 font-body rounded-sm" disabled={loading}>
                {loading ? 'Signing in...' : 'Access CRM Portal'}
              </Button>
            </form>
            <p className="text-[11px] text-slate-500 text-center mt-5 font-body">CRM Portal: crm@sahakar.com / crm123</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
