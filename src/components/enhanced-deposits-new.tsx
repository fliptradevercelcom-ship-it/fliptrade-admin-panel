import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from './ui/table';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Textarea } from './ui/textarea';
import { Calendar as CalendarComponent } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from './ui/dropdown-menu';
import { Plus, Edit, Trash2, Search, Filter, Calendar, X, UserPlus, DollarSign, MinusCircle, User, TrendingUp, Wallet, Calculator, ArrowUpDown, TrendingDown, CalendarIcon } from 'lucide-react';
import { useAdmin, type DepositEntry, type ClientIncentive, type ExpenseItem } from './admin-context-new';
import * as api from '../utils/api';
import { toast } from 'sonner@2.0.3';
import { TablePagination } from './table-pagination';
import { format } from 'date-fns';
import { MetricsSkeleton, TableSkeleton } from './shimmer-skeleton';
import { formatCurrency } from '../utils/currency';

const expenseTypes = ['Promotion', 'Salary', 'Miscellaneous', 'IB Commission', 'Travel Expense'] as const;

export function EnhancedDepositsNew() {
  const { 
    deposits, 
    setDeposits, 
    withdrawals, 
    getFilteredDeposits, 
    canViewAllEntries, 
    isAdmin,
    user,
    staff,
    addActivityLog,
    loadData,
    isLoading
  } = useAdmin();

  // Permission checks for current user
  const getCurrentUserPermissions = () => {
    if (!user) {
      console.log('Deposits - getCurrentUserPermissions: No user logged in');
      return null;
    }
    
    console.log('Deposits - getCurrentUserPermissions:', {
      userId: user.id,
      userName: user.name,
      userPermissions: user.permissions,
      depositsPermission: user.permissions?.deposits,
      staffArrayLength: staff.length
    });
    
    // First check if user has permissions directly
    if (user.permissions?.deposits) {
      console.log('Deposits - Using user.permissions.deposits:', user.permissions.deposits);
      return user.permissions.deposits;
    }
    
    // Fallback: check in staff array
    const currentStaff = staff.find(s => s.id === user.id);
    console.log('Deposits - Fallback to staff array:', {
      foundInStaff: !!currentStaff,
      staffPermissions: currentStaff?.permissions?.deposits
    });
    return currentStaff?.permissions.deposits || null;
  };

  const canEditDeposit = (deposit: DepositEntry) => {
    const permissions = getCurrentUserPermissions();
    console.log('Deposits - canEditDeposit check:', { 
      user: user?.name, 
      userId: user?.id,
      depositSubmittedBy: deposit.submittedBy,
      permissions, 
      canEdit: permissions?.edit,
      isAdmin: canViewAllEntries(),
      result: permissions ? (canViewAllEntries() ? permissions.edit : (permissions.edit && deposit.submittedBy === user?.id)) : false
    });
    if (!permissions) return false;
    
    // Admin can edit anything
    if (canViewAllEntries()) return permissions.edit;
    
    // Staff can only edit their own entries
    return permissions.edit && deposit.submittedBy === user?.id;
  };

  const canDeleteDeposit = (deposit: DepositEntry) => {
    const permissions = getCurrentUserPermissions();
    console.log('Deposits - canDeleteDeposit check:', { 
      user: user?.name, 
      userId: user?.id,
      depositSubmittedBy: deposit.submittedBy,
      permissions, 
      canDelete: permissions?.delete,
      isAdmin: canViewAllEntries(),
      result: permissions ? (canViewAllEntries() ? permissions.delete : (permissions.delete && deposit.submittedBy === user?.id)) : false
    });
    if (!permissions) return false;
    
    // Admin can delete anything
    if (canViewAllEntries()) return permissions.delete;
    
    // Staff can only delete their own entries
    return permissions.delete && deposit.submittedBy === user?.id;
  };

  const canAddDeposit = () => {
    const permissions = getCurrentUserPermissions();
    console.log('Deposits - canAddDeposit check:', { 
      user: user?.name, 
      userId: user?.id,
      permissions, 
      canAdd: permissions?.add 
    });
    return permissions?.add || false;
  };
  
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingDeposit, setEditingDeposit] = useState<DepositEntry | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [expenseTypeFilter, setExpenseTypeFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [selectedStaffFilter, setSelectedStaffFilter] = useState('all');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [sortBy, setSortBy] = useState('date-desc');
  
  // Loading state
  const [isSubmittingDeposit, setIsSubmittingDeposit] = useState(false);
  
  // New filter state
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [customDateRange, setCustomDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: undefined,
    to: undefined
  });
  const [isCustomDateOpen, setIsCustomDateOpen] = useState(false);
  const [employeeFilter, setEmployeeFilter] = useState('all');

  // Helper function to check if date is in range
  const isDateInRange = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    
    switch (dateFilter) {
      case 'today':
        return date.toDateString() === now.toDateString();
      case 'week':
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        return date >= weekAgo && date <= now;
      case 'month':
        const monthAgo = new Date(now);
        monthAgo.setMonth(now.getMonth() - 1);
        return date >= monthAgo && date <= now;
      case 'all':
      default:
        return true;
    }
  };

  // Check custom date range
  const isDateInCustomRange = (dateStr: string) => {
    if (!customDateRange.from && !customDateRange.to) return true;
    
    const date = new Date(dateStr);
    const from = customDateRange.from;
    const to = customDateRange.to;
    
    if (from && to) {
      return date >= from && date <= to;
    } else if (from) {
      return date >= from;
    } else if (to) {
      return date <= to;
    }
    
    return true;
  };

  const clearCustomDateRange = () => {
    setCustomDateRange({ from: undefined, to: undefined });
    setIsCustomDateOpen(false);
  };

  const hasNewActiveFilters = dateFilter !== 'all' || customDateRange.from || customDateRange.to || employeeFilter !== 'all';
  
  // Delete confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean;
    deposit: DepositEntry | null;
  }>({
    isOpen: false,
    deposit: null
  });
  
  // Form state for deposit entry
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    localDeposit: '',
    usdtDeposit: '',
    cashDeposit: '',
    localWithdraw: '',
    usdtWithdraw: '',
    cashWithdraw: '',
    selectedStaff: user?.id || '', // For admin selecting on behalf of staff
  });

  // Client incentives state
  const [clientIncentives, setClientIncentives] = useState<ClientIncentive[]>([
    { id: '1', name: '', amount: '' }
  ]);

  // Expenses state
  const [expenses, setExpenses] = useState<ExpenseItem[]>([
    { id: '1', type: 'Miscellaneous', amount: '', description: '' }
  ]);

  const resetForm = () => {
    setFormData({
      date: new Date().toISOString().split('T')[0],
      localDeposit: '',
      usdtDeposit: '',
      cashDeposit: '',
      localWithdraw: '',
      usdtWithdraw: '',
      cashWithdraw: '',
      selectedStaff: user?.id || '',
    });
    setClientIncentives([{ id: '1', name: '', amount: '' }]);
    setExpenses([{ id: '1', type: 'Miscellaneous', amount: '', description: '' }]);
    setEditingDeposit(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Filter valid client incentives and expenses (optional fields)
    const validClientIncentives = clientIncentives
      .filter(ci => {
        const amount = typeof ci.amount === 'string' ? parseFloat(ci.amount) || 0 : ci.amount;
        return ci.name.trim() !== '' && amount > 0;
      })
      .map(ci => ({
        ...ci,
        amount: typeof ci.amount === 'string' ? parseFloat(ci.amount) || 0 : ci.amount
      }));
    const validExpenses = expenses
      .filter(exp => {
        const amount = typeof exp.amount === 'string' ? parseFloat(exp.amount) || 0 : exp.amount;
        return amount > 0;
      })
      .map(exp => ({
        ...exp,
        amount: typeof exp.amount === 'string' ? parseFloat(exp.amount) || 0 : exp.amount
      }));
    
    // Client Incentives and Company Expenses are now optional - no validation required

    // Determine who is submitting this entry
    let submittedBy = user?.id || '';
    let submittedByName = user?.name || '';
    
    // If admin is creating on behalf of another staff member
    if (isAdmin() && formData.selectedStaff && formData.selectedStaff !== user?.id) {
      const selectedStaffMember = staff.find(s => s.id === formData.selectedStaff);
      if (selectedStaffMember) {
        submittedBy = selectedStaffMember.id;
        submittedByName = selectedStaffMember.name;
      }
    }

    const depositData = {
      date: formData.date,
      localDeposit: parseFloat(formData.localDeposit) || 0,
      usdtDeposit: parseFloat(formData.usdtDeposit) || 0,
      cashDeposit: parseFloat(formData.cashDeposit) || 0,
      localWithdraw: parseFloat(formData.localWithdraw) || 0,
      usdtWithdraw: parseFloat(formData.usdtWithdraw) || 0,
      cashWithdraw: parseFloat(formData.cashWithdraw) || 0,
      clientIncentives: validClientIncentives,
      expenses: validExpenses,
      submittedBy: submittedBy,
      submittedByName: submittedByName,
    };

    setIsSubmittingDeposit(true);

    try {
      if (editingDeposit) {
        await api.updateDeposit(editingDeposit.id, depositData);
        toast.success('Deposit entry updated successfully');
      } else {
        await api.createDeposit(depositData);
        toast.success('Deposit entry added successfully');
      }
      
      // Reload data from backend
      await loadData();
      setIsSheetOpen(false);
      resetForm();
    } catch (error: any) {
      console.error('Save deposit error:', error);
      toast.error(error.message || 'Failed to save deposit');
    } finally {
      setIsSubmittingDeposit(false);
    }
  };

  const handleEdit = (deposit: DepositEntry) => {
    setEditingDeposit(deposit);
    setFormData({
      date: deposit.date,
      localDeposit: deposit.localDeposit.toString(),
      usdtDeposit: deposit.usdtDeposit.toString(),
      cashDeposit: deposit.cashDeposit.toString(),
      localWithdraw: deposit.localWithdraw.toString(),
      usdtWithdraw: deposit.usdtWithdraw.toString(),
      cashWithdraw: deposit.cashWithdraw.toString(),
      selectedStaff: deposit.submittedBy,
    });
    setClientIncentives(deposit.clientIncentives.length > 0 ? deposit.clientIncentives : [{ id: '1', name: '', amount: '' }]);
    setExpenses(deposit.expenses.length > 0 ? deposit.expenses : [{ id: '1', type: 'Miscellaneous', amount: '', description: '' }]);
    setIsSheetOpen(true);
  };

  const handleDelete = (id: string) => {
    const depositToDelete = deposits.find(d => d.id === id);
    if (!depositToDelete) return;

    // Show confirmation dialog
    setDeleteConfirmation({
      isOpen: true,
      deposit: depositToDelete
    });
  };

  const confirmDeleteDeposit = async () => {
    const depositToDelete = deleteConfirmation.deposit;
    if (!depositToDelete) return;

    try {
      await api.deleteDeposit(depositToDelete.id);
      
      // Reload data from backend
      await loadData();
      
      setDeleteConfirmation({
        isOpen: false,
        deposit: null
      });
      
      toast.success('Deposit entry deleted successfully');
    } catch (error: any) {
      console.error('Delete deposit error:', error);
      toast.error(error.message || 'Failed to delete deposit');
    }
  };

  // Calculate dashboard metrics based on filtered data
  const calculateDashboardMetrics = (deposits: DepositEntry[]) => {
    const totalDeposits = deposits.reduce((sum, deposit) => 
      sum + deposit.localDeposit + deposit.usdtDeposit + deposit.cashDeposit, 0
    );
    
    const totalWithdraws = deposits.reduce((sum, deposit) => 
      sum + deposit.localWithdraw + deposit.usdtWithdraw + deposit.cashWithdraw, 0
    );
    
    const netDeposits = totalDeposits - totalWithdraws;
    
    const totalClientIncentives = deposits.reduce((sum, deposit) => 
      sum + deposit.clientIncentives.reduce((incentiveSum, incentive) => incentiveSum + incentive.amount, 0), 0
    );
    
    const totalCompanyExpenses = deposits.reduce((sum, deposit) => 
      sum + deposit.expenses.reduce((expSum, expense) => expSum + expense.amount, 0), 0
    );
    
    const netProfit = netDeposits - totalClientIncentives - totalCompanyExpenses;
    
    return {
      totalDeposits,
      totalWithdraws,
      netDeposits,
      totalClientIncentives,
      totalCompanyExpenses,
      netProfit,
      entryCount: deposits.length
    };
  };

  // Filter deposits based on search and filters with role-based access control
  const filteredDeposits = useMemo(() => {
    const userDeposits = getFilteredDeposits(); // Get deposits based on user role
    return userDeposits.filter((deposit) => {
      const matchesSearch = 
        deposit.clientIncentives.some(ci => ci.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        deposit.expenses.some(exp => exp.type.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                   exp.description?.toLowerCase().includes(searchTerm.toLowerCase())) ||
        deposit.date.includes(searchTerm) ||
        deposit.submittedByName.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesDate = (() => {
        if (!startDate && !endDate) return true;
        const depositDate = new Date(deposit.date);
        if (startDate && endDate) {
          return depositDate >= startDate && depositDate <= endDate;
        }
        if (startDate) {
          return depositDate >= startDate;
        }
        if (endDate) {
          return depositDate <= endDate;
        }
        return true;
      })();
      
      // New date filters
      const matchesDateFilter = dateFilter === 'all' || isDateInRange(deposit.date);
      const matchesCustomDateRange = isDateInCustomRange(deposit.date);
      
      const matchesExpenseType = expenseTypeFilter === 'all' || 
        deposit.expenses.some(exp => exp.type === expenseTypeFilter);
      const matchesStaff = selectedStaffFilter === 'all' || deposit.submittedBy === selectedStaffFilter;
      
      // New employee filter
      const matchesEmployee = employeeFilter === 'all' || deposit.submittedBy === employeeFilter;
      
      return matchesSearch && matchesDate && matchesDateFilter && matchesCustomDateRange && matchesExpenseType && matchesStaff && matchesEmployee;
    }).sort((a, b) => {
      switch (sortBy) {
        case 'date-desc':
          // Sort by date first (newest first), then by createdAt if available (most recent first)
          const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
          if (dateDiff !== 0) return dateDiff;
          // If same date, sort by createdAt (most recent first) if available
          const createdAtA = (a as any).createdAt ? new Date((a as any).createdAt).getTime() : 0;
          const createdAtB = (b as any).createdAt ? new Date((b as any).createdAt).getTime() : 0;
          if (createdAtA !== 0 || createdAtB !== 0) return createdAtB - createdAtA;
          // If no createdAt, use id as fallback (newer IDs typically come first)
          return b.id.localeCompare(a.id);
        case 'date-asc':
          // Sort by date first (oldest first), then by createdAt if available (oldest first)
          const dateDiffAsc = new Date(a.date).getTime() - new Date(b.date).getTime();
          if (dateDiffAsc !== 0) return dateDiffAsc;
          // If same date, sort by createdAt (oldest first) if available
          const createdAtAAsc = (a as any).createdAt ? new Date((a as any).createdAt).getTime() : 0;
          const createdAtBAsc = (b as any).createdAt ? new Date((b as any).createdAt).getTime() : 0;
          if (createdAtAAsc !== 0 || createdAtBAsc !== 0) return createdAtAAsc - createdAtBAsc;
          // If no createdAt, use id as fallback
          return a.id.localeCompare(b.id);
        case 'amount-desc':
          return calculateTotalDeposit(b) - calculateTotalDeposit(a);
        case 'amount-asc':
          return calculateTotalDeposit(a) - calculateTotalDeposit(b);
        case 'submitter-asc':
          return a.submittedByName.localeCompare(b.submittedByName);
        case 'submitter-desc':
          return b.submittedByName.localeCompare(a.submittedByName);
        default:
          return 0;
      }
    });
  }, [getFilteredDeposits, searchTerm, startDate, endDate, expenseTypeFilter, selectedStaffFilter, sortBy, dateFilter, customDateRange, employeeFilter]);

  // Group deposits by date and staff member (show separately even if same date)
  const groupedDeposits = useMemo(() => {
    return filteredDeposits.reduce((acc, deposit) => {
      const key = `${deposit.date}-${deposit.submittedBy}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(deposit);
      return acc;
    }, {} as Record<string, DepositEntry[]>);
  }, [filteredDeposits]);

  // Flatten grouped deposits for pagination (keeping separate entries for same date/different staff)
  const flattenedDeposits = useMemo(() => {
    return Object.entries(groupedDeposits).flatMap(([key, dateStaffDeposits]) => 
      dateStaffDeposits.map((deposit, index) => ({
        ...deposit,
        groupKey: key,
        groupIndex: Object.keys(groupedDeposits).indexOf(key)
      }))
    );
  }, [groupedDeposits]);

  const paginatedDeposits = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return flattenedDeposits.slice(startIndex, startIndex + itemsPerPage);
  }, [flattenedDeposits, currentPage, itemsPerPage]);

  const hasActiveFilters = searchTerm !== '' || startDate || endDate || expenseTypeFilter !== 'all' || selectedStaffFilter !== 'all' || hasNewActiveFilters;

  const clearAllFilters = () => {
    setSearchTerm('');
    setStartDate(undefined);
    setEndDate(undefined);
    setExpenseTypeFilter('all');
    setSelectedStaffFilter('all');
    setDateFilter('all');
    clearCustomDateRange();
    setEmployeeFilter('all');
    setCurrentPage(1);
  };

  const setCurrentPageState = (page: number) => {
    setCurrentPage(page);
  };

  const calculateTotalDeposit = (deposit: DepositEntry) => {
    const totalDeposits = deposit.localDeposit + deposit.usdtDeposit + deposit.cashDeposit;
    const totalWithdraws = deposit.localWithdraw + deposit.usdtWithdraw + deposit.cashWithdraw;
    return totalDeposits - totalWithdraws;
  };

  const calculateTotalIncentives = (deposit: DepositEntry) => {
    return deposit.clientIncentives.reduce((sum, ci) => sum + ci.amount, 0);
  };

  const calculateTotalExpenses = (deposit: DepositEntry) => {
    return deposit.expenses.reduce((sum, exp) => sum + exp.amount, 0);
  };

  const calculateTodaysBalance = (deposit: DepositEntry) => {
    const totalDeposit = calculateTotalDeposit(deposit);
    const totalIncentives = calculateTotalIncentives(deposit);
    const totalExpenses = calculateTotalExpenses(deposit);
    return totalDeposit - totalIncentives - totalExpenses;
  };

  const addClientIncentive = () => {
    setClientIncentives([...clientIncentives, { id: Date.now().toString(), name: '', amount: '' }]);
  };

  const updateClientIncentive = (id: string, field: keyof ClientIncentive, value: any) => {
    setClientIncentives(clientIncentives.map(ci => 
      ci.id === id ? { ...ci, [field]: value } : ci
    ));
  };

  const removeClientIncentive = (id: string) => {
    if (clientIncentives.length > 1) {
      setClientIncentives(clientIncentives.filter(ci => ci.id !== id));
    }
  };

  const addExpense = () => {
    setExpenses([...expenses, { id: Date.now().toString(), type: 'Miscellaneous', amount: '', description: '' }]);
  };

  const updateExpense = (id: string, field: keyof ExpenseItem, value: any) => {
    setExpenses(expenses.map(exp => 
      exp.id === id ? { ...exp, [field]: value } : exp
    ));
  };

  const removeExpense = (id: string) => {
    if (expenses.length > 1) {
      setExpenses(expenses.filter(exp => exp.id !== id));
    }
  };

  const dateColors = [
    'bg-blue-50 border-blue-200',
    'bg-green-50 border-green-200',
    'bg-yellow-50 border-yellow-200',
    'bg-purple-50 border-purple-200',
    'bg-pink-50 border-pink-200',
    'bg-indigo-50 border-indigo-200',
  ];

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="h-32 bg-gray-200 rounded-lg animate-shimmer relative overflow-hidden">
          <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-gray-200 via-white to-gray-200"></div>
        </div>
        <MetricsSkeleton count={4} />
        <TableSkeleton rows={10} columns={6} />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4 md:space-y-6 p-4 md:p-6">
        {/* Header */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
              <div>
                <CardTitle className="text-xl md:text-2xl">Daily Deposits Management</CardTitle>
                <CardDescription className="text-sm">
                  Track daily deposits, client incentives, and company expenses
                  {!canViewAllEntries() && (
                    <span className="block text-sm text-blue-600 mt-1">
                      <User className="w-4 h-4 inline mr-1" />
                      Showing only your entries
                    </span>
                  )}
                </CardDescription>
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
                    <CalendarComponent
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
                      disabled={(date) => date > new Date()}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>


                {/* Employee Filter - Only show for admin users */}
                {canViewAllEntries() && (
                  <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="All Employees" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Employees</SelectItem>
                      {staff.filter(s => s.status === 'active').map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* Clear All Filters */}
                {hasActiveFilters && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={clearAllFilters}
                    className="text-gray-600 hover:text-gray-700 text-xs flex items-center gap-1"
                  >
                    <X className="h-3 w-3" />
                    Clear All
                  </Button>
                )}

                {/* Add New Entry Button - Only visible if user has add permission */}
                {canAddDeposit() && (
                  <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                    <SheetTrigger asChild>
                      <Button className="bg-[#6a40ec] hover:bg-[#5a2fd9]" onClick={() => resetForm()}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add New Entry
                      </Button>
                    </SheetTrigger>
                  <SheetContent side="right" className="sm:max-w-[750px] overflow-y-auto">
                  <SheetHeader className="pb-4 border-b">
                    <SheetTitle>{editingDeposit ? 'Edit' : 'Add New'} Deposit Entry</SheetTitle>
                    <SheetDescription>
                      {editingDeposit ? 'Update the deposit information below' : 'Fill in the deposit information below'}
                    </SheetDescription>
                  </SheetHeader>
                  <form onSubmit={handleSubmit} className="py-4">
                    <div className="space-y-4">
                      {/* Transaction Information Section */}
                      <div className="bg-white border rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-[#6a40ec]/5 to-transparent border-b">
                          <div className="w-8 h-8 rounded-lg bg-[#6a40ec] flex items-center justify-center flex-shrink-0">
                            <Calendar className="w-4 h-4 text-white" />
                          </div>
                          <span className="font-semibold text-sm">Transaction Information</span>
                        </div>
                        
                        <div className="p-4">
                          <div className={`grid ${isAdmin() ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
                            <div className="space-y-1.5">
                              <Label htmlFor="date" className="text-sm font-medium text-gray-700 flex items-center">
                                Transaction Date <span className="text-red-500 ml-1">*</span>
                              </Label>
                              <Input
                                id="date"
                                type="date"
                                value={formData.date}
                                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                required
                                className="h-10"
                              />
                            </div>
                            
                            {/* Staff Selection (only for admins) */}
                            {isAdmin() && (
                              <div className="space-y-1.5">
                                <Label htmlFor="selectedStaff" className="text-sm font-medium text-gray-700 flex items-center">
                                  Submit on behalf of
                                </Label>
                                <Select 
                                  value={formData.selectedStaff} 
                                  onValueChange={(value) => setFormData({ ...formData, selectedStaff: value })}
                                >
                                  <SelectTrigger className="h-10">
                                    <SelectValue placeholder="Select staff member" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={user?.id || ''}>{user?.name} (Yourself)</SelectItem>
                                    {staff.filter(s => s.id !== user?.id && s.status === 'active').map((member) => (
                                      <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Deposit Amounts Section */}
                      <div className="bg-white border rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-[#6a40ec]/5 to-transparent border-b">
                          <div className="w-8 h-8 rounded-lg bg-[#6a40ec] flex items-center justify-center flex-shrink-0">
                            <TrendingUp className="w-4 h-4 text-white" />
                          </div>
                          <span className="font-semibold text-sm">Deposit Amounts</span>
                        </div>
                        
                        <div className="p-4">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="space-y-1.5">
                              <Label htmlFor="localDeposit" className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                <Wallet className="w-4 h-4 text-green-600" />
                                Local Deposit
                              </Label>
                              <Input
                                id="localDeposit"
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={formData.localDeposit}
                                onChange={(e) => setFormData({ ...formData, localDeposit: e.target.value })}
                                className="h-10"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="usdtDeposit" className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                <Wallet className="w-4 h-4 text-blue-600" />
                                USDT Deposit
                              </Label>
                              <Input
                                id="usdtDeposit"
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={formData.usdtDeposit}
                                onChange={(e) => setFormData({ ...formData, usdtDeposit: e.target.value })}
                                className="h-10"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="cashDeposit" className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                <Wallet className="w-4 h-4 text-purple-600" />
                                Cash Deposit
                              </Label>
                              <Input
                                id="cashDeposit"
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={formData.cashDeposit}
                                onChange={(e) => setFormData({ ...formData, cashDeposit: e.target.value })}
                                className="h-10"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Withdraw Amounts Section */}
                      <div className="bg-white border rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-[#6a40ec]/5 to-transparent border-b">
                          <div className="w-8 h-8 rounded-lg bg-[#6a40ec] flex items-center justify-center flex-shrink-0">
                            <TrendingDown className="w-4 h-4 text-white" />
                          </div>
                          <span className="font-semibold text-sm">Withdraw Amounts</span>
                        </div>
                        
                        <div className="p-4">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="space-y-1.5">
                              <Label htmlFor="localWithdraw" className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                <Wallet className="w-4 h-4 text-red-600" />
                                Local Withdraw
                              </Label>
                              <Input
                                id="localWithdraw"
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={formData.localWithdraw}
                                onChange={(e) => setFormData({ ...formData, localWithdraw: e.target.value })}
                                className="h-10"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="usdtWithdraw" className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                <Wallet className="w-4 h-4 text-red-600" />
                                USDT Withdraw
                              </Label>
                              <Input
                                id="usdtWithdraw"
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={formData.usdtWithdraw}
                                onChange={(e) => setFormData({ ...formData, usdtWithdraw: e.target.value })}
                                className="h-10"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="cashWithdraw" className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                <Wallet className="w-4 h-4 text-red-600" />
                                Cash Withdraw
                              </Label>
                              <Input
                                id="cashWithdraw"
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={formData.cashWithdraw}
                                onChange={(e) => setFormData({ ...formData, cashWithdraw: e.target.value })}
                                className="h-10"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Client Incentives Section */}
                      <div className="bg-white border rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-[#6a40ec]/5 to-transparent border-b">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-[#6a40ec] flex items-center justify-center flex-shrink-0">
                              <UserPlus className="w-4 h-4 text-white" />
                            </div>
                            <span className="font-semibold text-sm">Client Incentives</span>
                            {clientIncentives.filter(ci => {
                              const amount = typeof ci.amount === 'string' ? parseFloat(ci.amount) || 0 : (ci.amount || 0);
                              return amount > 0;
                            }).length > 0 && (
                              <span className="text-xs bg-[#6a40ec] text-white px-2 py-0.5 rounded-full">
                                {clientIncentives.filter(ci => {
                                  const amount = typeof ci.amount === 'string' ? parseFloat(ci.amount) || 0 : (ci.amount || 0);
                                  return amount > 0;
                                }).length}
                              </span>
                            )}
                          </div>
                          <Button type="button" variant="outline" size="sm" onClick={addClientIncentive} className="h-8">
                            <Plus className="w-3.5 h-3.5 mr-1.5" />
                            Add Client
                          </Button>
                        </div>
                        
                        <div className="p-4">
                          <div className="space-y-3">
                            {clientIncentives.map((incentive, index) => (
                              <div key={incentive.id} className="flex gap-3 items-end p-3 border rounded-lg bg-gray-50">
                                <div className="flex-1 space-y-1.5">
                                  <Label className="text-xs font-medium text-gray-700">
                                    Client Name
                                  </Label>
                                  <Input
                                    placeholder="Enter client name"
                                    value={incentive.name}
                                    onChange={(e) => updateClientIncentive(incentive.id, 'name', e.target.value)}
                                    className="h-10"
                                  />
                                </div>
                                <div className="flex-1 space-y-1.5">
                                  <Label className="text-xs font-medium text-gray-700">
                                    Incentive Amount ($)
                                  </Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={incentive.amount === 0 ? '' : (incentive.amount || '')}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      updateClientIncentive(incentive.id, 'amount', value === '' ? '' : (parseFloat(value) || 0));
                                    }}
                                    className="h-10"
                                  />
                                </div>
                                {clientIncentives.length > 1 && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="text-red-600 hover:text-red-800 h-10 w-10 p-0"
                                    onClick={() => removeClientIncentive(incentive.id)}
                                  >
                                    <MinusCircle className="w-4 h-4" />
                                  </Button>
                                )}
                              </div>
                            ))}
                            
                            {/* Total Incentives Summary */}
                            {clientIncentives.filter(ci => {
                              const amount = typeof ci.amount === 'string' ? parseFloat(ci.amount) || 0 : (ci.amount || 0);
                              return amount > 0;
                            }).length > 0 && (
                              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                <div className="flex justify-between items-center">
                                  <span className="text-sm font-medium text-blue-900">Total Client Incentives:</span>
                                  <span className="font-semibold text-blue-900">
                                    ${clientIncentives.reduce((sum, ci) => {
                                      const amount = typeof ci.amount === 'string' ? parseFloat(ci.amount) || 0 : (ci.amount || 0);
                                      return sum + amount;
                                    }, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Company Expenses Section */}
                      <div className="bg-white border rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-[#6a40ec]/5 to-transparent border-b">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-[#6a40ec] flex items-center justify-center flex-shrink-0">
                              <DollarSign className="w-4 h-4 text-white" />
                            </div>
                            <span className="font-semibold text-sm">Company Expenses</span>
                            {expenses.filter(exp => {
                              const amount = typeof exp.amount === 'string' ? parseFloat(exp.amount) || 0 : (exp.amount || 0);
                              return amount > 0;
                            }).length > 0 && (
                              <span className="text-xs bg-[#6a40ec] text-white px-2 py-0.5 rounded-full">
                                {expenses.filter(exp => {
                                  const amount = typeof exp.amount === 'string' ? parseFloat(exp.amount) || 0 : (exp.amount || 0);
                                  return amount > 0;
                                }).length}
                              </span>
                            )}
                          </div>
                          <Button type="button" variant="outline" size="sm" onClick={addExpense} className="h-8">
                            <Plus className="w-3.5 h-3.5 mr-1.5" />
                            Add Expense
                          </Button>
                        </div>
                        
                        <div className="p-4">
                          <div className="space-y-3">
                            {expenses.map((expense, index) => (
                              <div key={expense.id} className="p-3 border rounded-lg bg-gray-50">
                                <div className="grid grid-cols-5 gap-3 items-end mb-3">
                                  <div className="col-span-2 space-y-1.5">
                                    <Label className="text-xs font-medium text-gray-700">
                                      Expense Type
                                    </Label>
                                    <Select 
                                      value={expense.type} 
                                      onValueChange={(value) => updateExpense(expense.id, 'type', value as any)}
                                    >
                                      <SelectTrigger className="h-10">
                                        <SelectValue placeholder="Select type" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {expenseTypes.map((type) => (
                                          <SelectItem key={type} value={type}>{type}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="col-span-2 space-y-1.5">
                                    <Label className="text-xs font-medium text-gray-700">
                                      Amount ($)
                                    </Label>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      placeholder="0.00"
                                    value={expense.amount === 0 ? '' : (expense.amount || '')}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      updateExpense(expense.id, 'amount', value === '' ? '' : (parseFloat(value) || 0));
                                    }}
                                      className="h-10"
                                    />
                                  </div>
                                  <div className="flex items-end">
                                    {expenses.length > 1 && (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="text-red-600 hover:text-red-800 h-10 w-10 p-0"
                                        onClick={() => removeExpense(expense.id)}
                                      >
                                        <MinusCircle className="w-4 h-4" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-xs font-medium text-gray-700">Description</Label>
                                  <Textarea
                                    placeholder="Optional description"
                                    value={expense.description || ''}
                                    onChange={(e) => updateExpense(expense.id, 'description', e.target.value)}
                                    rows={2}
                                    className="resize-none"
                                  />
                                </div>
                              </div>
                            ))}
                            
                            {/* Total Expenses Summary */}
                            {expenses.filter(exp => {
                              const amount = typeof exp.amount === 'string' ? parseFloat(exp.amount) || 0 : (exp.amount || 0);
                              return amount > 0;
                            }).length > 0 && (
                              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                <div className="flex justify-between items-center">
                                  <span className="text-sm font-medium text-red-900">Total Company Expenses:</span>
                                  <span className="font-semibold text-red-900">
                                    ${expenses.reduce((sum, exp) => {
                                      const amount = typeof exp.amount === 'string' ? parseFloat(exp.amount) || 0 : (exp.amount || 0);
                                      return sum + amount;
                                    }, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end pt-5 mt-5 border-t">
                      <div className="flex items-center gap-3">
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={() => setIsSheetOpen(false)} 
                          className="h-10 px-6"
                          disabled={isSubmittingDeposit}
                        >
                          Cancel
                        </Button>
                        <Button 
                          type="submit" 
                          className="bg-[#6a40ec] hover:bg-[#5a2fd9] h-10 px-6"
                          disabled={isSubmittingDeposit}
                        >
                          {isSubmittingDeposit ? (
                            <>
                              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              {editingDeposit ? 'Updating...' : 'Adding...'}
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4 mr-2" />
                              {editingDeposit ? 'Update Entry' : 'Add Entry'}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </form>
                </SheetContent>
                </Sheet>
                )}
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Dashboard Cards */}
        {(() => {
          const metrics = calculateDashboardMetrics(filteredDeposits);
          return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="group relative overflow-hidden hover:shadow-2xl hover:scale-[1.02] transition-all duration-500 bg-gradient-to-br from-white via-green-50/40 to-green-100/15 border border-green-200/60 hover:border-green-400/30 backdrop-blur-sm">
                <div className="absolute inset-0 bg-gradient-to-br from-transparent via-white/20 to-green-400/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <CardHeader className="relative flex flex-row items-start justify-between space-y-0 pb-2 pt-4 px-4">
                  <div className="flex-1">
                    <CardTitle className="text-xs font-semibold text-gray-700 leading-tight tracking-wide uppercase">
                      Total Deposits
                    </CardTitle>
                  </div>
                  <div className="flex-shrink-0 p-2 bg-gradient-to-br from-green-400/15 via-green-400/20 to-green-400/25 rounded-lg shadow-sm border border-green-400/20 group-hover:shadow-md group-hover:scale-110 transition-all duration-300">
                    <DollarSign className="h-4 w-4 text-green-600 drop-shadow-sm" />
                  </div>
                </CardHeader>
                <CardContent className="relative px-4 pb-4 pt-1">
                  <div className="space-y-2">
                    <div className="text-2xl font-bold text-green-600 tracking-tight leading-none">
                      {formatCurrency(metrics.totalDeposits)}
                    </div>
                    <div className="flex items-center justify-start">
                      <div className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tracking-wide bg-green-100 text-green-700 border border-green-200">
                        {metrics.entryCount} entries
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="group relative overflow-hidden hover:shadow-2xl hover:scale-[1.02] transition-all duration-500 bg-gradient-to-br from-white via-red-50/40 to-red-100/15 border border-red-200/60 hover:border-red-400/30 backdrop-blur-sm">
                <div className="absolute inset-0 bg-gradient-to-br from-transparent via-white/20 to-red-400/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <CardHeader className="relative flex flex-row items-start justify-between space-y-0 pb-2 pt-4 px-4">
                  <div className="flex-1">
                    <CardTitle className="text-xs font-semibold text-gray-700 leading-tight tracking-wide uppercase">
                      Total Withdrawals
                    </CardTitle>
                  </div>
                  <div className="flex-shrink-0 p-2 bg-gradient-to-br from-red-400/15 via-red-400/20 to-red-400/25 rounded-lg shadow-sm border border-red-400/20 group-hover:shadow-md group-hover:scale-110 transition-all duration-300">
                    <TrendingDown className="h-4 w-4 text-red-600 drop-shadow-sm" />
                  </div>
                </CardHeader>
                <CardContent className="relative px-4 pb-4 pt-1">
                  <div className="space-y-2">
                    <div className="text-2xl font-bold text-red-600 tracking-tight leading-none">
                      {formatCurrency(metrics.totalWithdraws)}
                    </div>
                    <div className="flex items-center justify-start">
                      <div className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tracking-wide bg-gray-100 text-gray-700 border border-gray-200">
                        Net: {formatCurrency(metrics.netDeposits)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="group relative overflow-hidden hover:shadow-2xl hover:scale-[1.02] transition-all duration-500 bg-gradient-to-br from-white via-blue-50/40 to-blue-100/15 border border-blue-200/60 hover:border-blue-400/30 backdrop-blur-sm">
                <div className="absolute inset-0 bg-gradient-to-br from-transparent via-white/20 to-blue-400/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <CardHeader className="relative flex flex-row items-start justify-between space-y-0 pb-2 pt-4 px-4">
                  <div className="flex-1">
                    <CardTitle className="text-xs font-semibold text-gray-700 leading-tight tracking-wide uppercase">
                      Client Incentives
                    </CardTitle>
                  </div>
                  <div className="flex-shrink-0 p-2 bg-gradient-to-br from-blue-400/15 via-blue-400/20 to-blue-400/25 rounded-lg shadow-sm border border-blue-400/20 group-hover:shadow-md group-hover:scale-110 transition-all duration-300">
                    <UserPlus className="h-4 w-4 text-blue-600 drop-shadow-sm" />
                  </div>
                </CardHeader>
                <CardContent className="relative px-4 pb-4 pt-1">
                  <div className="space-y-2">
                    <div className="text-2xl font-bold text-blue-600 tracking-tight leading-none">
                      {formatCurrency(metrics.totalClientIncentives)}
                    </div>
                    <div className="flex items-center justify-start">
                      <div className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tracking-wide bg-orange-100 text-orange-700 border border-orange-200">
                        Expenses: {formatCurrency(metrics.totalCompanyExpenses)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="group relative overflow-hidden hover:shadow-2xl hover:scale-[1.02] transition-all duration-500 bg-gradient-to-br from-white via-purple-50/40 to-[#6a40ec]/15 border border-purple-200/60 hover:border-[#6a40ec]/30 backdrop-blur-sm">
                <div className="absolute inset-0 bg-gradient-to-br from-transparent via-white/20 to-[#6a40ec]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <CardHeader className="relative flex flex-row items-start justify-between space-y-0 pb-2 pt-4 px-4">
                  <div className="flex-1">
                    <CardTitle className="text-xs font-semibold text-gray-700 leading-tight tracking-wide uppercase">
                      Net Profit
                    </CardTitle>
                  </div>
                  <div className="flex-shrink-0 p-2 bg-gradient-to-br from-[#6a40ec]/15 via-[#6a40ec]/20 to-[#6a40ec]/25 rounded-lg shadow-sm border border-[#6a40ec]/20 group-hover:shadow-md group-hover:scale-110 transition-all duration-300">
                    <TrendingUp className="h-4 w-4 text-[#6a40ec] drop-shadow-sm" />
                  </div>
                </CardHeader>
                <CardContent className="relative px-4 pb-4 pt-1">
                  <div className="space-y-2">
                    <div className={`text-2xl font-bold tracking-tight leading-none ${metrics.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(metrics.netProfit)}
                    </div>
                    <div className="flex items-center justify-start">
                      <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tracking-wide transition-colors ${
                        metrics.netProfit >= 0 
                          ? 'bg-green-100 text-green-700 border border-green-200' 
                          : 'bg-red-100 text-red-700 border border-red-200'
                      }`}>
                        {metrics.netProfit >= 0 ? 'Profit' : 'Loss'}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })()}

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6 gap-4 mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search deposits..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div>
                <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <Calendar className="w-4 h-4 mr-2" />
                      {startDate || endDate ? (
                        `${startDate ? startDate.toLocaleDateString() : 'Start'} - ${endDate ? endDate.toLocaleDateString() : 'End'}`
                      ) : (
                        'Filter by date range'
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <div className="p-4">
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div>
                            <Label className="text-sm font-medium">Start Date</Label>
                            <CalendarComponent
                              mode="single"
                              selected={startDate}
                              onSelect={setStartDate}
                              disabled={(date) => date > new Date()}
                              className="rounded-md border"
                            />
                          </div>
                          <div>
                            <Label className="text-sm font-medium">End Date</Label>
                            <CalendarComponent
                              mode="single"
                              selected={endDate}
                              onSelect={setEndDate}
                              disabled={(date) => {
                                // Disable future dates and dates before start date
                                if (date > new Date()) return true;
                                if (startDate && date < startDate) return true;
                                return false;
                              }}
                              className="rounded-md border"
                            />
                          </div>
                        </div>
                        <div className="flex justify-between">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setStartDate(undefined);
                              setEndDate(undefined);
                            }}
                          >
                            Clear
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setIsDatePickerOpen(false);
                              if (startDate || endDate) {
                                toast.success('Date filter applied successfully');
                              }
                            }}
                          >
                            Apply
                          </Button>
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Select value={expenseTypeFilter} onValueChange={setExpenseTypeFilter}>
                  <SelectTrigger>
                    <Filter className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="Filter by expense type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Expense Types</SelectItem>
                    {expenseTypes.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Sort By */}
              <div>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger>
                    <ArrowUpDown className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date-desc">Date (Newest)</SelectItem>
                    <SelectItem value="date-asc">Date (Oldest)</SelectItem>
                    <SelectItem value="amount-desc">Amount (Highest)</SelectItem>
                    <SelectItem value="amount-asc">Amount (Lowest)</SelectItem>
                    <SelectItem value="submitter-asc">Submitter (A-Z)</SelectItem>
                    <SelectItem value="submitter-desc">Submitter (Z-A)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Staff Filter (only show for admins) */}
              {canViewAllEntries() && (
                <div>
                  <Select value={selectedStaffFilter} onValueChange={setSelectedStaffFilter}>
                    <SelectTrigger>
                      <User className="w-4 h-4 mr-2" />
                      <SelectValue placeholder="Filter by staff" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Staff Members</SelectItem>
                      {staff.filter(s => s.status === 'active').map((member) => (
                        <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-center space-x-2">
                {hasActiveFilters && (
                  <Button
                    variant="outline"
                    onClick={clearAllFilters}
                    className="flex items-center space-x-1"
                  >
                    <X className="h-4 w-4" />
                    <span>Clear Filters</span>
                  </Button>
                )}
                <span className="text-sm text-gray-500">
                  {filteredDeposits.length} of {deposits.length} entries
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Deposits Table */}
        <Card>
          <CardHeader>
            <CardTitle>Deposit Entries</CardTitle>
            <CardDescription>All deposit entries showing submitter and grouped by date/staff (separate entries for same date)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Submitted By</TableHead>
                    <TableHead>Local Deposit</TableHead>
                    <TableHead>USDT Deposit</TableHead>
                    <TableHead>Cash Deposit</TableHead>
                    <TableHead>Local Withdraw</TableHead>
                    <TableHead>USDT Withdraw</TableHead>
                    <TableHead>Cash Withdraw</TableHead>
                    <TableHead>Total Deposit</TableHead>
                    <TableHead>Client Incentive</TableHead>
                    <TableHead>Company Expense</TableHead>
                    <TableHead>Today's Balance</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedDeposits.map((deposit) => (
                    <TableRow
                      key={deposit.id}
                      className={`${dateColors[deposit.groupIndex % dateColors.length]} border-l-4`}
                    >
                      <TableCell className="font-medium">
                        {new Date(deposit.date).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {deposit.submittedByName}
                      </TableCell>
                      <TableCell>{formatCurrency(deposit.localDeposit)}</TableCell>
                      <TableCell>{formatCurrency(deposit.usdtDeposit)}</TableCell>
                      <TableCell>{formatCurrency(deposit.cashDeposit)}</TableCell>
                      <TableCell className="text-red-600">{formatCurrency(deposit.localWithdraw)}</TableCell>
                      <TableCell className="text-red-600">{formatCurrency(deposit.usdtWithdraw)}</TableCell>
                      <TableCell className="text-red-600">{formatCurrency(deposit.cashWithdraw)}</TableCell>
                      <TableCell className="font-medium">
                        {(() => {
                          const value = calculateTotalDeposit(deposit);
                          return value < 0 
                            ? `-$${Math.abs(value).toLocaleString()}` 
                            : `$${value.toLocaleString()}`;
                        })()}
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="text-sm cursor-help">
                              <div className="font-medium">
                                {deposit.clientIncentives.length === 1 
                                  ? deposit.clientIncentives[0].name 
                                  : `${deposit.clientIncentives.length} clients`}
                              </div>
                              <div className="text-gray-500">
                                {formatCurrency(calculateTotalIncentives(deposit))}
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="space-y-1">
                              {deposit.clientIncentives.map((ci, index) => (
                                <div key={index} className="text-sm">
                                  {ci.name}: {formatCurrency(ci.amount)}
                                </div>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="text-sm cursor-help">
                              <div className="font-medium">
                                {deposit.expenses.length === 1 
                                  ? deposit.expenses[0].type 
                                  : `${deposit.expenses.length} expenses`}
                              </div>
                              <div className="text-gray-500">
                                {formatCurrency(calculateTotalExpenses(deposit))}
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="space-y-1">
                              {deposit.expenses.map((exp, index) => (
                                <div key={index} className="text-sm">
                                  {exp.type}: {formatCurrency(exp.amount)}
                                  {exp.description && <div className="text-xs text-gray-500">{exp.description}</div>}
                                </div>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className={calculateTodaysBalance(deposit) >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {formatCurrency(calculateTodaysBalance(deposit))}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex space-x-2">
                          {canEditDeposit(deposit) ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEdit(deposit)}
                                  className="text-[#6a40ec] hover:text-[#5a2fd9] hover:bg-[#6a40ec]/10"
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit deposit entry</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled
                                  className="text-gray-300 cursor-not-allowed"
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {canViewAllEntries() ? "No edit permission" : "Can only edit your own entries"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          
                          {canDeleteDeposit(deposit) ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDelete(deposit.id)}
                                  className="text-red-600 hover:text-red-800"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete deposit entry</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled
                                  className="text-gray-300 cursor-not-allowed"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {canViewAllEntries() ? "No delete permission" : "Can only delete your own entries"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {paginatedDeposits.length > 0 && (
                  <TableFooter>
                    <TableRow className="bg-purple-50 hover:bg-purple-50 border-t-2 border-purple-200">
                      <TableCell className="font-bold">Total</TableCell>
                      <TableCell></TableCell>
                      <TableCell className="font-bold">
                        {formatCurrency(paginatedDeposits.reduce((sum, d) => sum + d.localDeposit, 0))}
                      </TableCell>
                      <TableCell className="font-bold">
                        {formatCurrency(paginatedDeposits.reduce((sum, d) => sum + d.usdtDeposit, 0))}
                      </TableCell>
                      <TableCell className="font-bold">
                        {formatCurrency(paginatedDeposits.reduce((sum, d) => sum + d.cashDeposit, 0))}
                      </TableCell>
                      <TableCell className="font-bold text-red-600">
                        {formatCurrency(paginatedDeposits.reduce((sum, d) => sum + d.localWithdraw, 0))}
                      </TableCell>
                      <TableCell className="font-bold text-red-600">
                        {formatCurrency(paginatedDeposits.reduce((sum, d) => sum + d.usdtWithdraw, 0))}
                      </TableCell>
                      <TableCell className="font-bold text-red-600">
                        {formatCurrency(paginatedDeposits.reduce((sum, d) => sum + d.cashWithdraw, 0))}
                      </TableCell>
                      <TableCell className="font-bold">
                        {formatCurrency(paginatedDeposits.reduce((sum, d) => sum + calculateTotalDeposit(d), 0))}
                      </TableCell>
                      <TableCell className="font-bold">
                        {formatCurrency(paginatedDeposits.reduce((sum, d) => sum + calculateTotalIncentives(d), 0))}
                      </TableCell>
                      <TableCell className="font-bold">
                        {formatCurrency(paginatedDeposits.reduce((sum, d) => sum + calculateTotalExpenses(d), 0))}
                      </TableCell>
                      <TableCell className="font-bold">
                        <span className={paginatedDeposits.reduce((sum, d) => sum + calculateTodaysBalance(d), 0) >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {formatCurrency(paginatedDeposits.reduce((sum, d) => sum + calculateTodaysBalance(d), 0))}
                        </span>
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
              {paginatedDeposits.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-gray-500">No deposit entries found matching your criteria.</p>
                </div>
              )}
            </div>
            
            {filteredDeposits.length > 0 && (
              <TablePagination
                totalItems={filteredDeposits.length}
                currentPage={currentPage}
                itemsPerPage={itemsPerPage}
                onPageChange={setCurrentPageState}
                onItemsPerPageChange={(newItemsPerPage) => {
                  setItemsPerPage(newItemsPerPage);
                  setCurrentPageState(1);
                }}
              />
            )}
          </CardContent>
        </Card>
        
        {/* Delete Confirmation Dialog */}
        <AlertDialog 
          open={deleteConfirmation.isOpen} 
          onOpenChange={(isOpen) => 
            setDeleteConfirmation({
              isOpen,
              deposit: null
            })
          }
        >
          <AlertDialogContent className="z-[100]">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-600" />
                Delete Deposit Entry
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this deposit entry from {deleteConfirmation.deposit?.date}? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={confirmDeleteDeposit}
                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}