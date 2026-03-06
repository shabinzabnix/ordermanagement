import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { toast } from 'sonner';
import { Pill, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
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
      await login(email, password);
      navigate('/dashboard');
      toast.success('Welcome back!');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="hidden lg:flex lg:w-1/2 relative bg-[#0F172A] items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://images.unsplash.com/photo-1552234458-9a63237d6d93?crop=entropy&cs=srgb&fm=jpg&q=85"
            alt="Pharmacy"
            className="w-full h-full object-cover opacity-15"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-br from-[#0F172A] via-[#0F172A]/80 to-sky-900/30" />
        <div className="relative z-10 text-center px-12">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-14 h-14 bg-sky-500 rounded-sm flex items-center justify-center shadow-lg shadow-sky-500/20">
              <Pill className="w-7 h-7 text-white" />
            </div>
          </div>
          <h1 className="text-4xl sm:text-5xl font-heading font-bold text-white mb-4 tracking-tight">
            Sahakar Hyper<br />Pharmacy
          </h1>
          <p className="text-base text-slate-400 font-body max-w-sm mx-auto leading-relaxed">
            Inventory Intelligence Platform
          </p>
          <div className="mt-10 flex justify-center gap-6 text-xs text-slate-500 font-body">
            <span>Cross-store visibility</span>
            <span className="text-slate-700">|</span>
            <span>Smart transfers</span>
            <span className="text-slate-700">|</span>
            <span>Purchase validation</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 bg-slate-50">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-sky-500 rounded-sm flex items-center justify-center">
              <Pill className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-heading font-bold text-slate-900">Sahakar Pharma</span>
          </div>
          <Card className="border-slate-200 shadow-sm rounded-sm">
            <CardHeader className="pb-4">
              <CardTitle className="font-heading text-2xl tracking-tight">Sign in</CardTitle>
              <CardDescription className="font-body text-sm">Enter your credentials to access the platform</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="font-body text-xs font-medium uppercase tracking-wider text-slate-500">Email</Label>
                  <Input
                    id="email"
                    data-testid="login-email-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@sahakar.com"
                    required
                    className="font-body rounded-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="font-body text-xs font-medium uppercase tracking-wider text-slate-500">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      data-testid="login-password-input"
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      required
                      className="font-body pr-10 rounded-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <Button
                  type="submit"
                  data-testid="login-submit-btn"
                  className="w-full bg-sky-500 hover:bg-sky-600 active:scale-[0.98] font-body rounded-sm transition-all"
                  disabled={loading}
                >
                  {loading ? 'Signing in...' : 'Sign in'}
                </Button>
              </form>
              <p className="text-[11px] text-slate-400 text-center mt-5 font-body">
                Default credentials: admin@sahakar.com / admin123
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
