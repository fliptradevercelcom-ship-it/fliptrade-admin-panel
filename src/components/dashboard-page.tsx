import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from './ui/dropdown-menu';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Users, UserPlus, Activity, DollarSign, Clock, Shield, TrendingUp, Wallet, Calculator, Filter, CalendarIcon, X, ArrowDownCircle, Receipt, Gift } from 'lucide-react';
import { useAdmin } from './admin-context-new';
import { format } from 'date-fns';
import { MetricsSkeleton, TableSkeleton, ListSkeleton } from './shimmer-skeleton';
import { supabase } from './admin-context-new';
import { projectId } from '../utils/supabase/info';
import { toast } from 'sonner@2.0.3';
import { formatCurrency } from '../utils/currency';

export function DashboardPage() {
  const { user, setCurrentPage, canViewDashboardExtras, canAccessStaffManagement, activityLogs, canViewAllEntries, isLoading: contextLoading } = useAdmin();
  
  // State to trigger re-render for dynamic time updates
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Update time every 30 seconds for dynamic relative time display
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000); // Update every 30 seconds
    
    return () => clearInterval(interval);
  }, []);
  
  // Filter state
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [customDateRange, setCustomDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: undefined,
    to: undefined
  });
  const [isCustomDateOpen, setIsCustomDateOpen] = useState(false);

  // Metrics state (fetched from backend)
  const [metrics, setMetrics] = useState({
    totalDeposits: 0,
    totalWithdrawals: 0,
    totalBalance: 0,
    totalCompanyExpenses: 0,
    balanceExcludingExpenses: 0,
    totalClientIncentives: 0,
    netProfit: 0,
  });

  const [counts, setCounts] = useState({
    depositsCount: 0,
    withdrawalsCount: 0,
  });

  const [isLoading, setIsLoading] = useState(true);

  // Fetch metrics from backend API
  const fetchMetrics = async () => {
    setIsLoading(true);
    let session = null;
    try {
      // Use the singleton supabase client from admin context
      const { data: sessionData } = await supabase.auth.getSession();
      session = sessionData.session;
      
      if (!session?.access_token) {
        console.error('No active session for dashboard metrics');
        setIsLoading(false);
        return;
      }

      // Build query parameters
      const params = new URLSearchParams();
      
      if (customDateRange.from || customDateRange.to) {
        if (customDateRange.from) {
          params.append('dateFrom', customDateRange.from.toISOString().split('T')[0]);
        }
        if (customDateRange.to) {
          params.append('dateTo', customDateRange.to.toISOString().split('T')[0]);
        }
      } else if (dateFilter !== 'all') {
        params.append('dateFilter', dateFilter);
      }

      // Fetch from backend
      const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-63060bc2/dashboard/metrics`;
      const queryString = params.toString();
      const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;
      
      console.log('Fetching dashboard metrics from:', url);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to fetch metrics');
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch metrics');
      }
      
      setMetrics(data.metrics);
      setCounts(data.counts);
      
    } catch (error: any) {
      console.error('Error fetching dashboard metrics:', error);
      console.error('Error details:', {
        message: error.message,
        projectId,
        hasSession: !!session?.access_token,
        dateFilter,
        customDateRange
      });
      toast.error(`Failed to load dashboard metrics: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchMetrics();
  }, [dateFilter, customDateRange]);

  const clearCustomDateRange = () => {
    setCustomDateRange({ from: undefined, to: undefined });
    setIsCustomDateOpen(false);
  };

  const hasActiveFilters = dateFilter !== 'all' || customDateRange.from || customDateRange.to;

  const stats = [
    {
      title: 'Total Deposits',
      value: formatCurrency(metrics.totalDeposits),
      change: counts.depositsCount > 0 ? `${counts.depositsCount} entries` : 'No data',
      changeType: 'neutral',
      icon: DollarSign,
      description: 'Local + USDT + Cash Deposits',
    },
    {
      title: 'Total Withdrawals',
      value: formatCurrency(metrics.totalWithdrawals),
      change: counts.withdrawalsCount > 0 ? `${counts.withdrawalsCount} transactions` : 'No withdrawals',
      changeType: 'negative',
      icon: ArrowDownCircle,
      description: 'All withdrawal transactions',
    },
    {
      title: 'Total Balance',
      value: formatCurrency(metrics.totalBalance),
      change: metrics.totalBalance > 0 ? '+' + ((metrics.totalBalance / (metrics.totalDeposits || 1)) * 100).toFixed(1) + '%' : '0%',
      changeType: metrics.totalBalance > 0 ? 'positive' : 'neutral',
      icon: Wallet,
      description: 'All Deposits - All Withdrawals',
    },
    {
      title: 'Total Company Expenses',
      value: formatCurrency(metrics.totalCompanyExpenses),
      change: metrics.totalCompanyExpenses > 0 ? `${formatCurrency(metrics.totalCompanyExpenses)} spent` : 'No expenses',
      changeType: 'negative',
      icon: Receipt,
      description: 'All company operational expenses',
    },
    {
      title: 'Total Client Incentives',
      value: formatCurrency(metrics.totalClientIncentives),
      change: metrics.totalClientIncentives > 0 ? `${formatCurrency(metrics.totalClientIncentives)} paid` : 'No incentives',
      changeType: 'negative',
      icon: Gift,
      description: 'All client incentive payments',
    },
    {
      title: 'Balance (Excluding Expenses)',
      value: formatCurrency(metrics.balanceExcludingExpenses),
      change: metrics.balanceExcludingExpenses > 0 ? '+' + ((metrics.balanceExcludingExpenses / (metrics.totalBalance || 1)) * 100).toFixed(1) + '%' : '0%',
      changeType: metrics.balanceExcludingExpenses > 0 ? 'positive' : 'negative',
      icon: Calculator,
      description: 'Total Balance - Company Expenses',
    },
    {
      title: 'Net Profit',
      value: formatCurrency(metrics.netProfit),
      change: metrics.netProfit > 0 ? '+' + ((metrics.netProfit / (metrics.balanceExcludingExpenses || 1)) * 100).toFixed(1) + '%' : '0%',
      changeType: metrics.netProfit > 0 ? 'positive' : 'negative',
      icon: TrendingUp,
      description: 'Balance Excluding Expenses - Client Incentives',
    },
  ];

  // Generate recent activities from activity logs - only financial activities
  const recentActivities = useMemo(() => {
    // Filter only financial activities (deposits and bank deposits)
    const financialActivityTypes = [
      'add_deposit',
      'edit_deposit',
      'delete_deposit',
      'add_bank_deposit',
      'edit_bank_deposit',
      'delete_bank_deposit',
      'add_bank_transaction',
      'edit_bank_transaction',
      'delete_bank_transaction',
    ];
    
    const financialLogs = activityLogs
      .filter(log => financialActivityTypes.includes(log.action))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);
    
    return financialLogs.map(log => {
      let type: 'success' | 'info' | 'warning' = 'success';
      
      if (log.action.includes('delete')) {
        type = 'warning';
      } else if (log.action.includes('edit')) {
        type = 'info';
      }
      
      return {
        id: log.id,
        action: log.description,
        user: log.userName,
        date: log.timestamp,
        type,
        details: log.details,
      };
    });
  }, [activityLogs]);

  // Helper function to format relative time (dynamic - updates with currentTime state)
  const getRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = currentTime; // Use currentTime state for dynamic updates
    const diffInMs = now.getTime() - date.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
    if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
    if (diffInDays === 1) return 'Yesterday';
    if (diffInDays < 7) return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
    return format(date, 'MMM dd, yyyy');
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <div className="flex items-center justify-between mb-6">
            <div className="space-y-2">
              <div className="h-9 w-80 bg-gray-200 rounded animate-shimmer relative overflow-hidden">
                <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-gray-200 via-white to-gray-200"></div>
              </div>
              <div className="h-5 w-96 bg-gray-200 rounded animate-shimmer relative overflow-hidden">
                <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-gray-200 via-white to-gray-200"></div>
              </div>
            </div>
          </div>
        </div>
        <MetricsSkeleton count={7} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ListSkeleton items={10} />
          <ListSkeleton items={10} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      {/* Welcome Header */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Financial Dashboard</h1>
            <p className="text-sm md:text-base text-gray-600 mt-1">Overview of deposits, withdrawals, expenses, and profit.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            {/* Quick Date Filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm"
                  className="justify-between"
                >
                  {dateFilter === 'all' && 'All Time'}
                  {dateFilter === 'today' && 'Today'}
                  {dateFilter === 'week' && 'This Week'}
                  {dateFilter === 'month' && 'This Month'}
                  <Filter className="ml-2 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem 
                  onClick={() => setDateFilter('all')}
                  className={dateFilter === 'all' ? 'bg-gray-100' : ''}
                >
                  All Time
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => setDateFilter('today')}
                  className={dateFilter === 'today' ? 'bg-gray-100' : ''}
                >
                  Today
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => setDateFilter('week')}
                  className={dateFilter === 'week' ? 'bg-gray-100' : ''}
                >
                  This Week
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => setDateFilter('month')}
                  className={dateFilter === 'month' ? 'bg-gray-100' : ''}
                >
                  This Month
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Custom Date Range */}
            <Popover open={isCustomDateOpen} onOpenChange={setIsCustomDateOpen}>
              <PopoverTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm"
                  className="justify-start text-left font-normal"
                >
                  <CalendarIcon className="mr-2 h-3 w-3" />
                  {customDateRange.from ? (
                    customDateRange.to ? (
                      <>
                        {format(customDateRange.from, "MMM dd")} - {format(customDateRange.to, "MMM dd, yyyy")}
                      </>
                    ) : (
                      format(customDateRange.from, "MMM dd, yyyy")
                    )
                  ) : (
                    "Date range"
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={customDateRange.from}
                  selected={customDateRange}
                  onSelect={(range) => {
                    setCustomDateRange({
                      from: range?.from,
                      to: range?.to
                    });
                  }}
                  numberOfMonths={2}
                  disabled={(date) => date > new Date()}
                />
              </PopoverContent>
            </Popover>
            
            {/* Clear Custom Date Range */}
            {(customDateRange.from || customDateRange.to) && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={clearCustomDateRange}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 p-1"
              >
                <X className="h-3 w-3" />
              </Button>
            )}

            {/* Active Filters Indicator & Clear All */}
            {hasActiveFilters && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  setDateFilter('all');
                  clearCustomDateRange();
                }}
                className="text-gray-600 hover:text-gray-700 text-xs"
              >
                Clear All
              </Button>
            )}

            {/* Role indicator badge - hidden for now */}
          </div>
        </div>
      </div>

      {/* Financial Stats Grid - 7 Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} className="group relative overflow-hidden hover:shadow-2xl hover:scale-[1.02] transition-all duration-500 bg-gradient-to-br from-white via-purple-50/40 to-[#6a40ec]/15 border border-purple-200/60 hover:border-[#6a40ec]/30 backdrop-blur-sm">
              <div className="absolute inset-0 bg-gradient-to-br from-transparent via-white/20 to-[#6a40ec]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <CardHeader className="relative flex flex-row items-start justify-between space-y-0 pb-2 pt-4 px-4">
                <div className="flex-1">
                  <CardTitle className="text-xs font-semibold text-gray-700 leading-tight tracking-wide uppercase">
                    {stat.title}
                  </CardTitle>
                </div>
                <div className="flex-shrink-0 p-2 bg-gradient-to-br from-[#6a40ec]/15 via-[#6a40ec]/20 to-[#6a40ec]/25 rounded-lg shadow-sm border border-[#6a40ec]/20 group-hover:shadow-md group-hover:scale-110 transition-all duration-300">
                  <Icon className="h-4 w-4 text-[#6a40ec] drop-shadow-sm" />
                </div>
              </CardHeader>
              <CardContent className="relative px-4 pb-4 pt-1">
                <div className="space-y-2">
                  <div className="text-2xl font-bold text-gray-900 tracking-tight leading-none">
                    {stat.value}
                  </div>
                  <div className="flex items-center justify-start">
                    <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tracking-wide transition-colors ${
                      stat.changeType === 'positive' 
                        ? 'bg-green-100 text-green-700 border border-green-200' :
                      stat.changeType === 'negative' 
                        ? 'bg-red-100 text-red-700 border border-red-200' : 
                        'bg-gray-100 text-gray-700 border border-gray-200'
                    }`}>
                      {stat.change}
                    </div>
                  </div>
                  <div className="pt-0.5">
                    <p className="text-xs text-gray-600 leading-relaxed font-medium">
                      {stat.description}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recent Financial Activity - Only show for admin/manager roles */}
      {canViewDashboardExtras() && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Financial Activity</CardTitle>
            <CardDescription>Latest financial transactions and updates</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivities.length > 0 ? (
              <div className="space-y-3">
                {recentActivities.map((activity) => (
                  <div key={activity.id} className="flex items-start gap-4 p-4 rounded-xl hover:bg-purple-50/50 border border-gray-200 hover:border-purple-200 transition-all duration-200 shadow-sm hover:shadow-md">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ring-4 ${
                      activity.type === 'success' ? 'bg-green-500 ring-green-100' :
                      activity.type === 'warning' ? 'bg-yellow-500 ring-yellow-100' :
                      'bg-blue-500 ring-blue-100'
                    }`} />
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="font-semibold text-gray-900 leading-tight">{activity.action}</p>
                      <p className="text-sm text-gray-600 truncate leading-tight">{activity.user}</p>
                      {activity.details && (
                        <p className="text-xs text-gray-500 mt-1 truncate leading-tight bg-gray-50 px-2 py-1 rounded-md inline-block">{activity.details}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 flex-shrink-0 mt-0.5 bg-gray-100 px-2.5 py-1.5 rounded-lg">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="font-medium">{getRelativeTime(activity.date)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Activity className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No recent activities to display</p>
              </div>
            )}
            {recentActivities.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <Button
                  variant="outline"
                  className="w-full border-[#6a40ec] text-[#6a40ec] hover:bg-[#6a40ec] hover:text-white transition-colors"
                  onClick={() => setCurrentPage('activity')}
                >
                  <Activity className="w-4 h-4 mr-2" />
                  View All Activities
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}


    </div>
  );
}