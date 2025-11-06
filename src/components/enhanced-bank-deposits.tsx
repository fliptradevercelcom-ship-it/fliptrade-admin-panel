import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { useDeleteConfirmation } from './use-delete-confirmation';
import { Switch } from './ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar as CalendarComponent } from './ui/calendar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Plus, Building2, Trash2, Search, Filter, Calendar, X, User, Settings, Edit2, DollarSign, TrendingUp, TrendingDown, ArrowUpDown, Wallet, CalendarIcon } from 'lucide-react';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from './ui/dropdown-menu';
import { useAdmin, type Bank, type BankTransaction } from './admin-context-new';
import * as api from '../utils/api';
import { toast } from 'sonner@2.0.3';
import { TablePagination } from './table-pagination';
import { MetricsSkeleton, TableSkeleton } from './shimmer-skeleton';
import { formatCurrency } from '../utils/currency';

export function EnhancedBankDeposits() {
  const { 
    banks, 
    setBanks, 
    bankTransactions, 
    setBankTransactions, 
    getFilteredBankTransactions, 
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
    if (!user) return null;
    
    // First check if user has permissions directly
    if (user.permissions?.bankDeposits) {
      return user.permissions.bankDeposits;
    }
    
    // Fallback: check in staff array
    const currentStaff = staff.find(s => s.id === user.id);
    return currentStaff?.permissions.bankDeposits || null;
  };

  const canEditTransaction = (transaction: BankTransaction) => {
    const permissions = getCurrentUserPermissions();
    if (!permissions) return false;
    
    // Admin can edit anything
    if (canViewAllEntries()) return permissions.edit;
    
    // Staff can only edit their own entries
    return permissions.edit && transaction.submittedBy === user?.id;
  };

  const canDeleteTransaction = (transaction: BankTransaction) => {
    const permissions = getCurrentUserPermissions();
    if (!permissions) return false;
    
    // Admin can delete anything
    if (canViewAllEntries()) return permissions.delete;
    
    // Staff can only delete their own entries
    return permissions.delete && transaction.submittedBy === user?.id;
  };

  const canAddTransaction = () => {
    const permissions = getCurrentUserPermissions();
    return permissions?.add || false;
  };

  const canAddBanks = () => {
    // Users with bank deposits add permission can add banks
    const permissions = getCurrentUserPermissions();
    console.log('Bank Deposits - canAddBanks check:', { 
      user: user?.name, 
      userId: user?.id,
      permissions, 
      canAdd: permissions?.add 
    });
    return permissions?.add || false;
  };

  const canEditBanks = () => {
    // Only admins can edit banks
    return canViewAllEntries() && getCurrentUserPermissions()?.edit;
  };

  const canDeleteBanks = () => {
    // Only admins can delete banks
    return canViewAllEntries() && getCurrentUserPermissions()?.delete;
  };
  
  const { showConfirmation, DeleteConfirmationDialog } = useDeleteConfirmation();
  
  const [isBankDialogOpen, setIsBankDialogOpen] = useState(false);
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false);
  const [newBankName, setNewBankName] = useState('');
  const [isManageBanksMode, setIsManageBanksMode] = useState(false);
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [editingBankName, setEditingBankName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [bankFilter, setBankFilter] = useState('all');
  
  // Enhanced Date Range Filter State (matching dashboard pattern)
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [customDateRange, setCustomDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: undefined,
    to: undefined
  });
  const [isCustomDateOpen, setIsCustomDateOpen] = useState(false);
  
  // Employee Filter State
  const [selectedEmployee, setSelectedEmployee] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState('date-desc');
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [transactionForm, setTransactionForm] = useState({
    date: new Date().toISOString().split('T')[0],
    bankId: 'none',
    deposit: '',
    withdraw: '',
    pnl: '',
    remainingBalance: '',
    selectedStaff: user?.id || '', // For admin selecting on behalf of staff
  });

  // Edit transaction state
  const [isEditTransactionDialogOpen, setIsEditTransactionDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<BankTransaction | null>(null);
  const [editTransactionForm, setEditTransactionForm] = useState({
    date: '',
    bankId: '',
    deposit: '',
    withdraw: '',
    pnl: '',
    remainingBalance: '',
    selectedStaff: '',
  });

  // Loading states
  const [isSubmittingTransaction, setIsSubmittingTransaction] = useState(false);

  // Searchable dropdown state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Calculate dashboard metrics for bank transactions
  const calculateBankMetrics = (transactions: BankTransaction[]) => {
    const totalDeposits = transactions.reduce((sum, transaction) => sum + transaction.deposit, 0);
    const totalWithdrawals = transactions.reduce((sum, transaction) => sum + transaction.withdraw, 0);
    const netBalance = totalDeposits - totalWithdrawals;
    const totalRemaining = transactions.reduce((sum, transaction) => sum + transaction.remaining, 0);
    
    // Calculate largest bank balance
    const bankBalances = banks.map(bank => {
      const bankTransactions = transactions.filter(t => t.bankId === bank.id);
      return {
        bankName: bank.name,
        balance: bankTransactions.length > 0 ? bankTransactions[bankTransactions.length - 1]?.remaining || 0 : 0
      };
    });
    
    const largestBalance = bankBalances.reduce((max, bank) => 
      bank.balance > max.balance ? bank : max, { bankName: 'N/A', balance: 0 }
    );
    
    return {
      totalDeposits,
      totalWithdrawals,
      netBalance,
      totalRemaining,
      activeBanks: banks.length,
      largestBalance,
      transactionCount: transactions.length
    };
  };

  const resetTransactionForm = () => {
    setTransactionForm({
      date: new Date().toISOString().split('T')[0],
      bankId: 'none',
      deposit: '',
      withdraw: '',
      pnl: '',
      remainingBalance: '',
      selectedStaff: user?.id || '',
    });
  };

  const handleAddBank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBankName.trim()) return;

    try {
      const response = await api.addBank(newBankName.trim());
      
      if (response.success && response.bank) {
        setBanks([...banks, response.bank]);
        addActivityLog('add_bank', `Added new bank: ${newBankName.trim()}`);
        setNewBankName('');
        setIsBankDialogOpen(false);
        toast.success('Bank added successfully');
      }
    } catch (error: any) {
      console.error('Add bank error:', error);
      toast.error(error.message || 'Failed to add bank');
    }
  };

  const handleDeleteBank = async (bankId: string) => {
    const bankToDelete = banks.find(b => b.id === bankId);
    if (!bankToDelete) return;

    // Check if bank has transactions
    const hasTransactions = bankTransactions.some(t => t.bankId === bankId);
    if (hasTransactions) {
      toast.error(`Cannot delete ${bankToDelete.name} as it has existing transactions`);
      return;
    }

    // Show confirmation dialog
    showConfirmation({
      title: 'Delete Bank',
      description: `Are you sure you want to delete "${bankToDelete.name}"? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          await api.deleteBank(bankId);
          setBanks(banks.filter(b => b.id !== bankId));
          addActivityLog('delete_bank', `Deleted bank: ${bankToDelete.name}`);
          toast.success(`${bankToDelete.name} deleted successfully`);
        } catch (error: any) {
          console.error('Delete bank error:', error);
          toast.error(error.message || 'Failed to delete bank');
        }
      }
    });
  };



  const handleEditBank = (bank: Bank) => {
    setEditingBankId(bank.id);
    setEditingBankName(bank.name);
  };

  const handleSaveEdit = async (bankId: string) => {
    if (!editingBankName.trim()) {
      toast.error('Bank name cannot be empty');
      return;
    }

    // Check if name already exists (excluding current bank)
    const nameExists = banks.some(b => b.id !== bankId && b.name.toLowerCase() === editingBankName.trim().toLowerCase());
    if (nameExists) {
      toast.error('A bank with this name already exists');
      return;
    }

    const oldBankName = banks.find(b => b.id === bankId)?.name || '';
    
    try {
      await api.updateBank(bankId, editingBankName.trim());
      
      setBanks(banks.map(b => 
      b.id === bankId 
        ? { ...b, name: editingBankName.trim() }
        : b
    ));
    
    addActivityLog('edit_bank', `Updated bank name from "${oldBankName}" to "${editingBankName.trim()}"`);
    
    setEditingBankId(null);
    setEditingBankName('');
      toast.success('Bank name updated successfully');
    } catch (error: any) {
      console.error('Update bank error:', error);
      toast.error(error.message || 'Failed to update bank');
    }
  };

  const handleCancelEdit = () => {
    setEditingBankId(null);
    setEditingBankName('');
  };

  // Filter Helper Functions (matching dashboard pattern)
  const clearCustomDateRange = () => {
    setCustomDateRange({ from: undefined, to: undefined });
    setDateFilter('all');
  };

  const clearAllFilters = () => {
    setDateFilter('all');
    setCustomDateRange({ from: undefined, to: undefined });
    setSelectedEmployee('all');
    setBankFilter('all');
    setSearchTerm('');
    setSortBy('date-desc');
  };

  // Get the previous balance for a specific bank
  const getPreviousBalance = (bankId: string, currentDate?: string, excludeTransactionId?: string) => {
    if (bankId === 'none' || !bankId) return 0;
    
    const previousTransactions = bankTransactions
      .filter(t => {
        const matchesBank = t.bankId === bankId;
        const matchesDate = !currentDate || t.date < currentDate;
        const notExcluded = !excludeTransactionId || t.id !== excludeTransactionId;
        return matchesBank && matchesDate && notExcluded;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    if (previousTransactions.length === 0) return 0;
    
    // Return the most recent remaining balance
    return previousTransactions[0].remaining || previousTransactions[0].remainingBalance || 0;
  };

  const calculateRemaining = (bankId: string, currentDate: string, newDeposit: number, newWithdraw: number) => {
    const previousBalance = getPreviousBalance(bankId, currentDate);
    return previousBalance + newDeposit - newWithdraw;
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transactionForm.bankId || transactionForm.bankId === 'none') {
      toast.error('Please select a bank');
      return;
    }

    setIsSubmittingTransaction(true);

    const deposit = parseFloat(transactionForm.deposit) || 0;
    const withdraw = parseFloat(transactionForm.withdraw) || 0;
    const pnl = parseFloat(transactionForm.pnl) || 0;
    const remainingBalance = parseFloat(transactionForm.remainingBalance) || calculateRemaining(transactionForm.bankId, transactionForm.date, deposit, withdraw);

    // Determine who is submitting this entry
    let submittedBy = user?.id || '';
    let submittedByName = user?.name || '';
    
    // If admin is creating on behalf of another staff member
    if (isAdmin() && transactionForm.selectedStaff && transactionForm.selectedStaff !== user?.id) {
      const selectedStaffMember = staff.find(s => s.id === transactionForm.selectedStaff);
      if (selectedStaffMember) {
        submittedBy = selectedStaffMember.id;
        submittedByName = selectedStaffMember.name;
      }
    }

    const transactionData = {
      date: transactionForm.date,
      bankId: transactionForm.bankId,
      deposit,
      withdraw,
      pnl: pnl !== 0 ? pnl : undefined,
      remaining: remainingBalance,
      remainingBalance: remainingBalance,
      amount: deposit, // For compatibility
      submittedBy: submittedBy,
      submittedByName: submittedByName,
    };

    try {
      await api.createBankDeposit(transactionData);
      await loadData();
      resetTransactionForm();
      setIsTransactionDialogOpen(false);
      toast.success('Transaction added successfully');
    } catch (error: any) {
      console.error('Add transaction error:', error);
      toast.error(error.message || 'Failed to add transaction');
    } finally {
      setIsSubmittingTransaction(false);
    }
  };





  const setCurrentPageState = (page: number) => {
    setCurrentPage(page);
  };

  const filteredBanks = banks.filter(bank =>
    bank.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleBankSelect = (bankId: string) => {
    const depositAmount = parseFloat(transactionForm.deposit || '0');
    const withdrawAmount = parseFloat(transactionForm.withdraw || '0');
    const pnlAmount = parseFloat(transactionForm.pnl || '0');
    
    // Calculate balance: Deposit - Withdraw + P&L
    const newBalance = depositAmount - withdrawAmount + pnlAmount;
    
    setTransactionForm({ 
      ...transactionForm, 
      bankId,
      remainingBalance: newBalance.toFixed(2)
    });
    setIsDropdownOpen(false);
    setSearchQuery('');
  };

  const handleDeleteTransaction = (id: string) => {
    const transactionToDelete = bankTransactions.find(t => t.id === id);
    if (!transactionToDelete) return;

    const bank = banks.find(b => b.id === transactionToDelete.bankId);
    const bankName = bank?.name || 'Unknown Bank';

    // Show confirmation dialog
    showConfirmation({
      title: 'Delete Transaction',
      description: `Are you sure you want to delete this transaction from ${bankName}? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          await api.deleteBankDeposit(transactionToDelete.id);
          await loadData();
          toast.success('Transaction deleted successfully');
        } catch (error: any) {
          console.error('Delete transaction error:', error);
          toast.error(error.message || 'Failed to delete transaction');
        }
      }
    });
  };



  const handleEditTransaction = (transaction: BankTransaction) => {
    setEditingTransaction(transaction);
    setEditTransactionForm({
      date: transaction.date,
      bankId: transaction.bankId,
      deposit: transaction.deposit.toString(),
      withdraw: transaction.withdraw.toString(),
      pnl: transaction.pnl !== undefined && transaction.pnl !== null ? transaction.pnl.toString() : '',
      remainingBalance: (transaction.remainingBalance || transaction.remaining || 0).toString(),
      selectedStaff: transaction.submittedBy,
    });
    setIsEditTransactionDialogOpen(true);
  };

  const handleUpdateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTransaction) return;

    if (!editTransactionForm.bankId || editTransactionForm.bankId === 'none') {
      toast.error('Please select a bank');
      return;
    }

    setIsSubmittingTransaction(true);

    const deposit = parseFloat(editTransactionForm.deposit) || 0;
    const withdraw = parseFloat(editTransactionForm.withdraw) || 0;
    const pnl = parseFloat(editTransactionForm.pnl) || 0;
    
    // Use provided remaining balance or recalculate
    const remainingBalance = parseFloat(editTransactionForm.remainingBalance) || calculateRemaining(editTransactionForm.bankId, editTransactionForm.date, deposit, withdraw);

    // Determine who is submitting this transaction
    let submittedBy = editTransactionForm.selectedStaff;
    let submittedByName = '';
    
    if (submittedBy === user?.id) {
      submittedByName = user?.name || '';
    } else {
      const selectedStaffMember = staff.find(s => s.id === submittedBy);
      submittedByName = selectedStaffMember?.name || '';
    }

    const updateData = {
      date: editTransactionForm.date,
      bankId: editTransactionForm.bankId,
      deposit,
      withdraw,
      pnl: pnl !== 0 ? pnl : undefined,
      remaining: remainingBalance,
      remainingBalance: remainingBalance,
      submittedBy,
      submittedByName,
      amount: deposit, // For compatibility
    };

    try {
      await api.updateBankDeposit(editingTransaction.id, updateData);
      await loadData();
      
      const bankName = banks.find(b => b.id === editTransactionForm.bankId)?.name || 'Unknown Bank';
      addActivityLog('edit_bank_transaction', `Updated bank transaction for ${bankName}`, `Date: ${format(new Date(editTransactionForm.date), 'MMM dd, yyyy')}, Deposit: ${formatCurrency(deposit)}`);
      
      setIsEditTransactionDialogOpen(false);
      setEditingTransaction(null);
      resetEditTransactionForm();
      toast.success('Transaction updated successfully');
    } catch (error: any) {
      console.error('Update transaction error:', error);
      toast.error(error.message || 'Failed to update transaction');
    } finally {
      setIsSubmittingTransaction(false);
    }
  };

  const resetEditTransactionForm = () => {
    setEditTransactionForm({
      date: '',
      bankId: '',
      deposit: '',
      withdraw: '',
      pnl: '',
      remainingBalance: '',
      selectedStaff: '',
    });
    setEditingTransaction(null);
  };

  // Enhanced Filtering Logic with Sorting (matching dashboard pattern)
  const filteredTransactions = useMemo(() => {
    let filtered = getFilteredBankTransactions();

    // Apply date range filter
    if (customDateRange.from || customDateRange.to) {
      filtered = filtered.filter(transaction => {
        const transactionDate = new Date(transaction.date);
        const from = customDateRange.from;
        const to = customDateRange.to;
        
        if (from && to) {
          return transactionDate >= from && transactionDate <= to;
        } else if (from) {
          return transactionDate >= from;
        } else if (to) {
          return transactionDate <= to;
        }
        return true;
      });
    } else if (dateFilter !== 'all') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      filtered = filtered.filter(transaction => {
        const transactionDate = new Date(transaction.date);
        transactionDate.setHours(0, 0, 0, 0);
        
        switch (dateFilter) {
          case 'today':
            return transactionDate.getTime() === today.getTime();
          case 'week':
            const weekAgo = new Date(today);
            weekAgo.setDate(today.getDate() - 7);
            return transactionDate >= weekAgo && transactionDate <= today;
          case 'month':
            const monthAgo = new Date(today);
            monthAgo.setMonth(today.getMonth() - 1);
            return transactionDate >= monthAgo && transactionDate <= today;
          default:
            return true;
        }
      });
    }

    // Apply employee filter (only for admins)
    if (canViewAllEntries() && selectedEmployee !== 'all') {
      filtered = filtered.filter(transaction => transaction.submittedBy === selectedEmployee);
    }

    // Apply bank filter
    if (bankFilter !== 'all') {
      filtered = filtered.filter(transaction => transaction.bankId === bankFilter);
    }

    // Apply search term filter
    if (searchTerm) {
      filtered = filtered.filter(transaction => {
        const bank = banks.find(b => b.id === transaction.bankId);
        const submitterName = transaction.submittedByName || '';
        return (
          bank?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          submitterName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          transaction.deposit.toString().includes(searchTerm) ||
          transaction.withdraw.toString().includes(searchTerm) ||
          transaction.date.includes(searchTerm) ||
          (transaction.remainingBalance || transaction.remaining || 0).toString().includes(searchTerm)
        );
      });
    }

    // Apply sorting (create a copy to avoid mutation)
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'date-desc':
          // Sort by date first (newest first), then by createdAt if available (most recent first)
          const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
          if (dateDiff !== 0) return dateDiff;
          // If same date, sort by createdAt (most recent first) if available
          const createdAtA = (a as any).createdAt ? new Date((a as any).createdAt).getTime() : 0;
          const createdAtB = (b as any).createdAt ? new Date((b as any).createdAt).getTime() : 0;
          return createdAtB - createdAtA;
        case 'date-asc':
          // Sort by date first (oldest first), then by createdAt if available (oldest first)
          const dateDiffAsc = new Date(a.date).getTime() - new Date(b.date).getTime();
          if (dateDiffAsc !== 0) return dateDiffAsc;
          // If same date, sort by createdAt (oldest first) if available
          const createdAtAAsc = (a as any).createdAt ? new Date((a as any).createdAt).getTime() : 0;
          const createdAtBAsc = (b as any).createdAt ? new Date((b as any).createdAt).getTime() : 0;
          return createdAtAAsc - createdAtBAsc;
        case 'deposit-desc':
          return (b.deposit || 0) - (a.deposit || 0);
        case 'deposit-asc':
          return (a.deposit || 0) - (b.deposit || 0);
        case 'withdraw-desc':
          return (b.withdraw || 0) - (a.withdraw || 0);
        case 'withdraw-asc':
          return (a.withdraw || 0) - (b.withdraw || 0);
        case 'remaining-desc':
          return (b.remainingBalance || b.remaining || 0) - (a.remainingBalance || a.remaining || 0);
        case 'remaining-asc':
          return (a.remainingBalance || a.remaining || 0) - (b.remainingBalance || b.remaining || 0);
        case 'bank-asc':
          const bankA = banks.find(bank => bank.id === a.bankId)?.name || '';
          const bankB = banks.find(bank => bank.id === b.bankId)?.name || '';
          return bankA.localeCompare(bankB);
        case 'bank-desc':
          const bankA2 = banks.find(bank => bank.id === a.bankId)?.name || '';
          const bankB2 = banks.find(bank => bank.id === b.bankId)?.name || '';
          return bankB2.localeCompare(bankA2);
        default:
          return 0;
      }
    });
    return sorted;
  }, [
    bankTransactions, 
    dateFilter,
    customDateRange,
    selectedEmployee, 
    bankFilter,
    searchTerm, 
    sortBy,
    banks, 
    canViewAllEntries,
    getFilteredBankTransactions
  ]);

  // Calculate metrics based on filtered transactions
  const metrics = useMemo(() => {
    const totalDeposits = filteredTransactions.reduce((sum, t) => sum + t.deposit, 0);
    const totalWithdrawals = filteredTransactions.reduce((sum, t) => sum + t.withdraw, 0);
    const netBalance = totalDeposits - totalWithdrawals;
    const totalRemaining = filteredTransactions.reduce((sum, t) => sum + (t.remainingBalance || t.remaining || 0), 0);
    
    // Calculate largest bank balance
    const bankBalances = banks.map(bank => {
      const bankTransactions = filteredTransactions.filter(t => t.bankId === bank.id);
      return {
        bankName: bank.name,
        balance: bankTransactions.length > 0 ? bankTransactions[bankTransactions.length - 1]?.remaining || bankTransactions[bankTransactions.length - 1]?.remainingBalance || 0 : 0
      };
    });
    
    const largestBalance = bankBalances.reduce((max, bank) => 
      bank.balance > max.balance ? bank : max, { bankName: 'N/A', balance: 0 }
    );

    return {
      totalDeposits,
      totalWithdrawals,
      netBalance,
      totalRemaining,
      activeBanks: banks.length,
      largestBalance,
      transactionCount: filteredTransactions.length
    };
  }, [filteredTransactions, banks]);

  // Paginated transactions
  const paginatedTransactions = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredTransactions.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredTransactions, currentPage, itemsPerPage]);

  // Check if there are active filters
  const hasActiveFilters = useMemo(() => {
    return (
      dateFilter !== 'all' ||
      customDateRange.from !== undefined ||
      customDateRange.to !== undefined ||
      selectedEmployee !== 'all' ||
      bankFilter !== 'all' ||
      searchTerm !== '' ||
      sortBy !== 'date-desc'
    );
  }, [dateFilter, customDateRange, selectedEmployee, bankFilter, searchTerm, sortBy]);

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="h-32 bg-gray-200 rounded-lg animate-shimmer relative overflow-hidden">
          <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-gray-200 via-white to-gray-200"></div>
        </div>
        <MetricsSkeleton count={6} />
        <TableSkeleton rows={10} columns={7} />
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
              <CardTitle className="text-xl md:text-2xl">Bank Deposits Management</CardTitle>
              <CardDescription className="text-sm">
                Track bank deposits and withdrawals with detailed transaction history
                {!canViewAllEntries() && (
                  <span className="block text-sm text-blue-600 mt-1">
                    <User className="w-4 h-4 inline mr-1" />
                    Showing only your transactions
                  </span>
                )}
              </CardDescription>
            </div>

            {/* Filter Controls */}
            <div className="flex flex-wrap items-center gap-2">
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
                    numberOfMonths={2}
                    disabled={(date) => date > new Date()}
                  />
                </PopoverContent>
              </Popover>
              
              {/* Clear Custom Date Range */}
              {/* {(customDateRange.from || customDateRange.to) && (
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={clearCustomDateRange}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 p-1"
                >
                  <X className="h-3 w-3" />
                </Button>
              )} */}

              {/* Employee Filter - Only for Admins */}
              {/* {canViewAllEntries() && (
                <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                  <SelectTrigger className="w-48">
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
              )} */}

              {/* Clear All Filters */}
              {hasActiveFilters && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={clearAllFilters}
                  className="flex items-center space-x-1"
                >
                  <X className="w-4 h-4" />
                  <span>Clear All</span>
                </Button>
              )}
            </div>
            <div className="flex space-x-2">
              {canAddBanks() && (
                <Sheet open={isBankDialogOpen} onOpenChange={(open) => {
                  setIsBankDialogOpen(open);
                  if (open) {
                    setIsManageBanksMode(false); // Reset to add mode when opening
                    setNewBankName(''); // Clear form
                  }
                }}>
                  <SheetTrigger asChild>
                    <Button variant="outline">
                      <Building2 className="w-4 h-4 mr-2" />
                      Add Bank
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="sm:max-w-[600px] w-full p-0 flex flex-col h-full">
                    {/* Fixed Header with Padding */}
                    <div className="px-6 pt-6 pb-5 border-b flex-shrink-0 bg-white">
                      <SheetHeader>
                        <SheetTitle className="text-xl text-left">
                          {canEditBanks() && isManageBanksMode ? 'Manage Banks' : 'Add New Bank'}
                        </SheetTitle>
                        <SheetDescription className="text-sm text-left">
                          {canEditBanks() && isManageBanksMode 
                            ? 'View and manage existing banks' 
                            : 'Add a new bank to the system'
                          }
                        </SheetDescription>
                      </SheetHeader>
                    </div>
                  
                  {/* Switch between Add and Manage modes - only for admins */}
                  {canEditBanks() && (
                    <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0 bg-gray-50">
                      <Label htmlFor="manage-mode" className="text-sm font-medium text-gray-700">
                        {isManageBanksMode ? 'Manage Banks' : 'Add Bank'}
                      </Label>
                      <div className="flex items-center gap-2.5">
                        <Switch
                          id="manage-mode"
                          checked={isManageBanksMode}
                          onCheckedChange={setIsManageBanksMode}
                        />
                        <Settings className="w-4 h-4 text-gray-500" />
                      </div>
                    </div>
                  )}

                    {(!canEditBanks() || !isManageBanksMode) ? (
                      <form onSubmit={handleAddBank} className="flex flex-col flex-1 overflow-hidden">
                        {/* Scrollable Content with Padding */}
                        <div className="flex-1 overflow-y-auto px-6 py-6 bg-gray-50">
                          {/* Bank Info Section */}
                          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                            <div className="flex items-center gap-3 px-6 py-4 bg-gradient-to-r from-[#6a40ec]/5 to-transparent border-b">
                              <div className="w-10 h-10 rounded-lg bg-[#6a40ec] flex items-center justify-center flex-shrink-0 shadow-sm">
                                <Building2 className="w-5 h-5 text-white" />
                              </div>
                              <span className="font-semibold text-base text-gray-900">Bank Information</span>
                            </div>
                            
                            <div className="px-6 py-6">
                              <div className="space-y-2.5">
                                <Label htmlFor="bankName" className="text-sm font-medium text-gray-700 block">
                                  Bank Name <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                  id="bankName"
                                  placeholder="Enter bank name (e.g., Chase Bank, Bank of America)"
                                  value={newBankName}
                                  onChange={(e) => setNewBankName(e.target.value)}
                                  required
                                  className="h-12 text-sm border-gray-300 focus:border-[#6a40ec] focus:ring-[#6a40ec]"
                                />
                                <p className="text-xs text-gray-500 leading-relaxed pt-1">
                                  Enter the full name of the bank you want to add to the system
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Fixed Action Buttons with Proper Spacing */}
                        <div className="flex items-center justify-end gap-3 px-6 py-5 border-t bg-white flex-shrink-0">
                          <Button 
                            type="button" 
                            variant="outline" 
                            onClick={() => setIsBankDialogOpen(false)}
                            className="h-11 px-8 min-w-[120px] border-gray-300 hover:bg-gray-50"
                          >
                            Cancel
                          </Button>
                          <Button 
                            type="submit" 
                            className="bg-[#6a40ec] hover:bg-[#5a2fd9] h-11 px-8 min-w-[140px] shadow-sm"
                          >
                            <Plus className="w-4 h-4 mr-2" />
                            Add Bank
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-col flex-1 overflow-hidden">
                        {/* Scrollable Content with Padding */}
                        <div className="flex-1 overflow-y-auto px-6 py-6 bg-gray-50">
                          {/* Info Banner */}
                          <div className="bg-gradient-to-r from-blue-50 to-blue-100/50 border border-blue-200 rounded-xl p-4 mb-5 shadow-sm">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm">
                                <Building2 className="w-4.5 h-4.5 text-white" />
                              </div>
                              <div>
                                <span className="text-sm font-semibold text-blue-900">Total Banks</span>
                                <p className="text-xs text-blue-700 mt-0.5">{banks.length} bank{banks.length !== 1 ? 's' : ''} in the system</p>
                              </div>
                            </div>
                          </div>

                          {/* Full management interface for admins */}
                          {canEditBanks() && (
                            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                              {/* Table Header - Fixed */}
                              <div className="bg-gradient-to-r from-gray-50 to-gray-100/50 border-b px-6 py-3">
                                <h3 className="text-sm font-semibold text-gray-900">Bank List</h3>
                              </div>
                              
                              {/* Table Content - Scrollable */}
                              <div className="max-h-[400px] overflow-y-auto">
                                <Table>
                                  <TableHeader className="sticky top-0 bg-gray-50 z-10">
                                    <TableRow>
                                      <TableHead className="font-semibold text-gray-700">Bank Name</TableHead>
                                      <TableHead className="font-semibold text-gray-700">Transactions</TableHead>
                                      <TableHead className="font-semibold text-gray-700 text-right">Actions</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {banks.map((bank) => {
                                      const transactionCount = bankTransactions.filter(t => t.bankId === bank.id).length;
                                      const canDelete = transactionCount === 0;
                                      const isEditing = editingBankId === bank.id;
                                      
                                      return (
                                        <TableRow key={bank.id} className="hover:bg-gray-50/50">
                                          <TableCell className="font-medium text-gray-900 py-4">
                                            {isEditing ? (
                                              <div className="flex items-center gap-2">
                                                <Input
                                                  value={editingBankName}
                                                  onChange={(e) => setEditingBankName(e.target.value)}
                                                  className="h-9 flex-1 border-gray-300 focus:border-[#6a40ec] focus:ring-[#6a40ec]"
                                                  autoFocus
                                                  onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleSaveEdit(bank.id);
                                                    if (e.key === 'Escape') handleCancelEdit();
                                                  }}
                                                />
                                                <Button
                                                  size="sm"
                                                  onClick={() => handleSaveEdit(bank.id)}
                                                  className="h-9 px-4 bg-[#6a40ec] hover:bg-[#5a2fd9] shadow-sm"
                                                >
                                                  Save
                                                </Button>
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  onClick={handleCancelEdit}
                                                  className="h-9 px-4 border-gray-300"
                                                >
                                                  Cancel
                                                </Button>
                                              </div>
                                            ) : (
                                              <div className="flex items-center gap-2">
                                                <Building2 className="w-4 h-4 text-[#6a40ec]" />
                                                {bank.name}
                                              </div>
                                            )}
                                          </TableCell>
                                          <TableCell className="text-sm text-gray-600 py-4">
                                            <div className="flex items-center gap-2">
                                              <DollarSign className="w-3.5 h-3.5 text-gray-400" />
                                              {transactionCount} transaction{transactionCount !== 1 ? 's' : ''}
                                            </div>
                                          </TableCell>
                                          <TableCell className="py-4">
                                            {!isEditing && (
                                              <div className="flex items-center justify-end gap-2">
                                                {canEditBanks() && (
                                                  <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleEditBank(bank)}
                                                    className="h-9 px-3 text-[#6a40ec] hover:text-[#5a2fd9] hover:bg-[#6a40ec]/10"
                                                    title="Edit bank name"
                                                  >
                                                    <Edit2 className="w-4 h-4" />
                                                  </Button>
                                                )}
                                                {canDeleteBanks() && (
                                                  <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDeleteBank(bank.id)}
                                                    disabled={!canDelete}
                                                    className={canDelete ? "h-9 px-3 text-red-600 hover:text-red-700 hover:bg-red-50" : "h-9 px-3 text-gray-400 cursor-not-allowed"}
                                                    title={canDelete ? "Delete bank" : "Cannot delete bank with existing transactions"}
                                                  >
                                                    <Trash2 className="w-4 h-4" />
                                                  </Button>
                                                )}
                                              </div>
                                            )}
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                                {banks.length === 0 && (
                                  <div className="text-center py-12 px-4">
                                    <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                    <p className="text-sm font-medium text-gray-900 mb-1">No banks found</p>
                                    <p className="text-xs text-gray-500">Switch to Add mode to create your first bank</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        
                        {/* Fixed Footer with Close Button */}
                        <div className="flex items-center justify-end px-6 py-5 border-t bg-white flex-shrink-0">
                          <Button 
                            variant="outline" 
                            onClick={() => setIsBankDialogOpen(false)}
                            className="h-11 px-8 min-w-[120px] border-gray-300 hover:bg-gray-50"
                          >
                            Close
                          </Button>
                        </div>
                      </div>
                    )}
                  </SheetContent>
                </Sheet>
              )}

              {canAddTransaction() ? (
                <Sheet open={isTransactionDialogOpen} onOpenChange={setIsTransactionDialogOpen}>
                  <SheetTrigger asChild>
                    <Button className="bg-[#6a40ec] hover:bg-[#5a2fd9]" onClick={resetTransactionForm}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Transaction
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="sm:max-w-[750px] overflow-y-auto">
                  <SheetHeader className="pb-4 border-b">
                    <SheetTitle>Add Bank Transaction</SheetTitle>
                    <SheetDescription>Record a new deposit or withdrawal transaction</SheetDescription>
                  </SheetHeader>
                  
                  <form onSubmit={handleAddTransaction} className="py-4">
                    <div className="space-y-4">
                      {/* Transaction Info Section */}
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
                                value={transactionForm.date}
                                onChange={(e) => setTransactionForm({ ...transactionForm, date: e.target.value })}
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
                                  value={transactionForm.selectedStaff} 
                                  onValueChange={(value) => setTransactionForm({ ...transactionForm, selectedStaff: value })}
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

                      {/* Bank Selection Section */}
                      <div className="bg-white border rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-[#6a40ec]/5 to-transparent border-b">
                          <div className="w-8 h-8 rounded-lg bg-[#6a40ec] flex items-center justify-center flex-shrink-0">
                            <Building2 className="w-4 h-4 text-white" />
                          </div>
                          <span className="font-semibold text-sm">Bank Selection</span>
                        </div>
                        
                        <div className="p-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="bank" className="text-sm font-medium text-gray-700 flex items-center">
                              Select Bank <span className="text-red-500 ml-1">*</span>
                            </Label>
                            <Select 
                              value={transactionForm.bankId} 
                              onValueChange={(value) => setTransactionForm({ ...transactionForm, bankId: value })}
                            >
                              <SelectTrigger className="h-10">
                                <SelectValue placeholder="Select a bank..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none" disabled>
                                  <span className="text-gray-400">Select a bank...</span>
                                </SelectItem>
                                {banks.map((bank) => (
                                  <SelectItem key={bank.id} value={bank.id}>
                                    <div className="flex items-center gap-2">
                                      <Building2 className="w-4 h-4 text-[#6a40ec]" />
                                      <span>{bank.name}</span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      {/* Transaction Amounts Section */}
                      <div className="bg-white border rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-[#6a40ec]/5 to-transparent border-b">
                          <div className="w-8 h-8 rounded-lg bg-[#6a40ec] flex items-center justify-center flex-shrink-0">
                            <DollarSign className="w-4 h-4 text-white" />
                          </div>
                          <span className="font-semibold text-sm">Transaction Amounts</span>
                        </div>
                        
                        <div className="p-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <Label htmlFor="deposit" className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded bg-green-100 flex items-center justify-center flex-shrink-0">
                                  <TrendingUp className="w-3 h-3 text-green-700" />
                                </div>
                                Deposit
                              </Label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-sm">$</span>
                                <Input
                                  id="deposit"
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  value={transactionForm.deposit}
                                  onChange={(e) => {
                                    const depositValue = e.target.value;
                                    const depositAmount = parseFloat(depositValue || '0');
                                    const withdrawAmount = parseFloat(transactionForm.withdraw || '0');
                                    const pnlAmount = parseFloat(transactionForm.pnl || '0');
                                    
                                    // Calculate balance: Deposit - Withdraw + P&L
                                    const newBalance = depositAmount - withdrawAmount + pnlAmount;
                                    
                                    setTransactionForm({ 
                                      ...transactionForm, 
                                      deposit: depositValue,
                                      remainingBalance: newBalance.toFixed(2)
                                    });
                                  }}
                                  className="pl-8 h-10"
                                />
                              </div>
                            </div>
                            
                            <div className="space-y-1.5">
                              <Label htmlFor="withdraw" className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded bg-red-100 flex items-center justify-center flex-shrink-0">
                                  <TrendingDown className="w-3 h-3 text-red-700" />
                                </div>
                                Withdraw
                              </Label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-sm">$</span>
                                <Input
                                  id="withdraw"
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  value={transactionForm.withdraw}
                                  onChange={(e) => {
                                    const withdrawValue = e.target.value;
                                    const depositAmount = parseFloat(transactionForm.deposit || '0');
                                    const withdrawAmount = parseFloat(withdrawValue || '0');
                                    const pnlAmount = parseFloat(transactionForm.pnl || '0');
                                    
                                    // Calculate balance: Deposit - Withdraw + P&L
                                    const newBalance = depositAmount - withdrawAmount + pnlAmount;
                                    
                                    setTransactionForm({ 
                                      ...transactionForm, 
                                      withdraw: withdrawValue,
                                      remainingBalance: newBalance.toFixed(2)
                                    });
                                  }}
                                  className="pl-8 h-10"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* P&L and Balance Section */}
                      <div className="bg-white border rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-[#6a40ec]/5 to-transparent border-b">
                          <div className="w-8 h-8 rounded-lg bg-[#6a40ec] flex items-center justify-center flex-shrink-0">
                            <ArrowUpDown className="w-4 h-4 text-white" />
                          </div>
                          <span className="font-semibold text-sm">P&L & amount</span>
                        </div>
                        
                        <div className="p-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <Label htmlFor="pnl" className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded bg-purple-100 flex items-center justify-center flex-shrink-0">
                                  <TrendingUp className="w-3 h-3 text-purple-700" />
                                </div>
                                P&L Amount
                              </Label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-sm">$</span>
                              <Input
                                id="pnl"
                                type="text"
                                placeholder="+150.00 or -75.50"
                                value={transactionForm.pnl || ''}
                                onChange={(e) => {
                                  const pnlValue = e.target.value;
                                  const depositAmount = parseFloat(transactionForm.deposit || '0');
                                  const withdrawAmount = parseFloat(transactionForm.withdraw || '0');
                                  const pnlAmount = parseFloat(pnlValue || '0');
                                  
                                  // Calculate balance: Deposit - Withdraw + P&L
                                  const newBalance = depositAmount - withdrawAmount + pnlAmount;
                                  
                                  setTransactionForm({ 
                                    ...transactionForm, 
                                    pnl: pnlValue,
                                    remainingBalance: newBalance.toFixed(2)
                                  });
                                }}
                                  className={`pl-8 pr-10 h-10 ${
                                    transactionForm.pnl && !isNaN(parseFloat(transactionForm.pnl)) 
                                      ? parseFloat(transactionForm.pnl) >= 0 
                                        ? 'border-green-400 focus:border-green-500 bg-green-50/50' 
                                        : 'border-red-400 focus:border-red-500 bg-red-50/50'
                                      : ''
                                  }`}
                                />
                                {transactionForm.pnl && !isNaN(parseFloat(transactionForm.pnl)) && (
                                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                    {parseFloat(transactionForm.pnl) >= 0 ? (
                                      <TrendingUp className="w-4 h-4 text-green-600" />
                                    ) : (
                                      <TrendingDown className="w-4 h-4 text-red-600" />
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            <div className="space-y-1.5">
                              <Label htmlFor="remainingBalance" className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded bg-blue-100 flex items-center justify-center flex-shrink-0">
                                  <Wallet className="w-3 h-3 text-blue-700" />
                                </div>
                                Balance (Auto)
                              </Label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-sm">$</span>
                                <Input
                                  id="remainingBalance"
                                  type="text"
                                  placeholder="0.00"
                                  value={transactionForm.remainingBalance ? parseFloat(transactionForm.remainingBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                                  readOnly
                                  className={`pl-8 pr-10 h-10 cursor-not-allowed font-semibold ${
                                    transactionForm.remainingBalance && parseFloat(transactionForm.remainingBalance) < 0
                                      ? 'border-red-400 text-red-700 bg-red-50'
                                      : transactionForm.remainingBalance && parseFloat(transactionForm.remainingBalance) > 0
                                      ? 'border-green-400 text-green-700 bg-green-50'
                                      : 'bg-gray-100 border-gray-300'
                                  }`}
                                />
                                {transactionForm.remainingBalance && parseFloat(transactionForm.remainingBalance) !== 0 && (
                                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                    {parseFloat(transactionForm.remainingBalance) >= 0 ? (
                                      <TrendingUp className="w-4 h-4 text-green-600" />
                                    ) : (
                                      <TrendingDown className="w-4 h-4 text-red-600" />
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mt-2 flex items-center gap-1.5">
                            <span className="inline-block w-1 h-1 rounded-full bg-gray-400"></span>
                            Use + for profit, - for loss
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-end pt-5 mt-5 border-t">
                      <div className="flex items-center gap-3">
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={() => setIsTransactionDialogOpen(false)} 
                          className="h-10 px-6"
                          disabled={isSubmittingTransaction}
                        >
                          Cancel
                        </Button>
                        <Button 
                          type="submit" 
                          className="bg-[#6a40ec] hover:bg-[#5a2fd9] h-10 px-6"
                          disabled={isSubmittingTransaction}
                        >
                          {isSubmittingTransaction ? (
                            <>
                              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Adding...
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4 mr-2" />
                              Add Transaction
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </form>
                </SheetContent>
                </Sheet>
              ) : (
                <Button disabled className="bg-gray-300 cursor-not-allowed">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Transaction
                </Button>
              )}

              {/* Edit Transaction Sheet */}
              <Sheet open={isEditTransactionDialogOpen} onOpenChange={(open) => {
                setIsEditTransactionDialogOpen(open);
                if (!open) {
                  resetEditTransactionForm();
                }
              }}>
                <SheetContent side="right" className="sm:max-w-[750px] overflow-y-auto">
                  <SheetHeader className="pb-4 border-b">
                    <SheetTitle>Edit Bank Transaction</SheetTitle>
                    <SheetDescription>Update transaction details</SheetDescription>
                  </SheetHeader>
                  
                  <form onSubmit={handleUpdateTransaction} className="py-4">
                    <div className="space-y-4">
                      {/* Transaction Info Section */}
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
                              <Label htmlFor="edit-date" className="text-sm font-medium text-gray-700 flex items-center mb-2">
                                Transaction Date <span className="text-red-500 ml-1">*</span>
                              </Label>
                              <Input
                                id="edit-date"
                                type="date"
                                value={editTransactionForm.date}
                                onChange={(e) => {
                                  const newDate = e.target.value;
                                  const depositAmount = parseFloat(editTransactionForm.deposit || '0');
                                  const withdrawAmount = parseFloat(editTransactionForm.withdraw || '0');
                                  const pnlAmount = parseFloat(editTransactionForm.pnl || '0');
                                  
                                  // Calculate balance: Deposit - Withdraw + P&L (same as Add form)
                                  const newBalance = depositAmount - withdrawAmount + pnlAmount;
                                  
                                  setEditTransactionForm({ 
                                    ...editTransactionForm, 
                                    date: newDate,
                                    remainingBalance: newBalance.toFixed(2)
                                  });
                                }}
                                required
                                className="h-10"
                              />
                            </div>
                            
                            {/* Staff Selection (only for admins) */}
                            {isAdmin() && (
                              <div className="space-y-1.5">
                                <Label htmlFor="edit-selectedStaff" className="text-sm font-medium text-gray-700 flex items-center mb-2">
                                  Submitted by
                                </Label>
                                <Select 
                                  value={editTransactionForm.selectedStaff} 
                                  onValueChange={(value) => setEditTransactionForm({ ...editTransactionForm, selectedStaff: value })}
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

                      {/* Bank Selection Section */}
                      <div className="bg-white border rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-[#6a40ec]/5 to-transparent border-b">
                          <div className="w-8 h-8 rounded-lg bg-[#6a40ec] flex items-center justify-center flex-shrink-0">
                            <Building2 className="w-4 h-4 text-white" />
                          </div>
                          <span className="font-semibold text-sm">Bank Selection</span>
                        </div>
                        
                        <div className="p-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-bank" className="text-sm font-medium text-gray-700 flex items-center mb-2">
                              Select Bank <span className="text-red-500 ml-1">*</span>
                            </Label>
                            <Select 
                              value={editTransactionForm.bankId} 
                              onValueChange={(value) => {
                                const depositAmount = parseFloat(editTransactionForm.deposit || '0');
                                const withdrawAmount = parseFloat(editTransactionForm.withdraw || '0');
                                const pnlAmount = parseFloat(editTransactionForm.pnl || '0');
                                
                                // Calculate balance: Deposit - Withdraw + P&L (same as Add form)
                                const newBalance = depositAmount - withdrawAmount + pnlAmount;
                                
                                setEditTransactionForm({ 
                                  ...editTransactionForm, 
                                  bankId: value,
                                  remainingBalance: newBalance.toFixed(2)
                                });
                              }}
                            >
                              <SelectTrigger className="h-10">
                                <SelectValue placeholder="Select a bank" />
                              </SelectTrigger>
                              <SelectContent>
                                {banks.map((bank) => (
                                  <SelectItem key={bank.id} value={bank.id}>
                                    <div className="flex items-center gap-2">
                                      <Building2 className="w-4 h-4 text-[#6a40ec]" />
                                      <span>{bank.name}</span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      {/* Transaction Amounts Section */}
                      <div className="bg-white border rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-[#6a40ec]/5 to-transparent border-b">
                          <div className="w-8 h-8 rounded-lg bg-[#6a40ec] flex items-center justify-center flex-shrink-0">
                            <DollarSign className="w-4 h-4 text-white" />
                          </div>
                          <span className="font-semibold text-sm">Transaction Amounts</span>
                        </div>
                        
                        <div className="p-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <Label htmlFor="edit-deposit" className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-2">
                                <div className="w-5 h-5 rounded bg-green-100 flex items-center justify-center flex-shrink-0">
                                  <TrendingUp className="w-3 h-3 text-green-700" />
                                </div>
                                Deposit
                              </Label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-sm">$</span>
                                <Input
                                  id="edit-deposit"
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  value={editTransactionForm.deposit}
                                  onChange={(e) => {
                                    const depositValue = e.target.value;
                                    const depositAmount = parseFloat(depositValue || '0');
                                    const withdrawAmount = parseFloat(editTransactionForm.withdraw || '0');
                                    const pnlAmount = parseFloat(editTransactionForm.pnl || '0');
                                    
                                    // Calculate balance: Deposit - Withdraw + P&L (same as Add form)
                                    const newBalance = depositAmount - withdrawAmount + pnlAmount;
                                    
                                    setEditTransactionForm({ 
                                      ...editTransactionForm, 
                                      deposit: depositValue,
                                      remainingBalance: newBalance.toFixed(2)
                                    });
                                  }}
                                  className="pl-8 h-10"
                                />
                              </div>
                            </div>
                            
                            <div className="space-y-1.5">
                              <Label htmlFor="edit-withdraw" className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-2">
                                <div className="w-5 h-5 rounded bg-red-100 flex items-center justify-center flex-shrink-0">
                                  <TrendingDown className="w-3 h-3 text-red-700" />
                                </div>
                                Withdraw
                              </Label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-sm">$</span>
                                <Input
                                  id="edit-withdraw"
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  value={editTransactionForm.withdraw}
                                  onChange={(e) => {
                                    const withdrawValue = e.target.value;
                                    const depositAmount = parseFloat(editTransactionForm.deposit || '0');
                                    const withdrawAmount = parseFloat(withdrawValue || '0');
                                    const pnlAmount = parseFloat(editTransactionForm.pnl || '0');
                                    
                                    // Calculate balance: Deposit - Withdraw + P&L (same as Add form)
                                    const newBalance = depositAmount - withdrawAmount + pnlAmount;
                                    
                                    setEditTransactionForm({ 
                                      ...editTransactionForm, 
                                      withdraw: withdrawValue,
                                      remainingBalance: newBalance.toFixed(2)
                                    });
                                  }}
                                  className="pl-8 h-10"
                                />
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4 mt-4">
                            <div className="space-y-1.5">
                              <Label htmlFor="edit-pnl" className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-2">
                                <div className="w-5 h-5 rounded bg-purple-100 flex items-center justify-center flex-shrink-0">
                                  <TrendingUp className="w-3 h-3 text-purple-700" />
                                </div>
                                P&L Amount
                              </Label>
                              <div className="relative">
                                <Input
                                  id="edit-pnl"
                                  type="text"
                                  placeholder="+150.00 or -75.50"
                                  value={editTransactionForm.pnl || ''}
                                  onChange={(e) => {
                                    const pnlValue = e.target.value;
                                    const depositAmount = parseFloat(editTransactionForm.deposit || '0');
                                    const withdrawAmount = parseFloat(editTransactionForm.withdraw || '0');
                                    const pnlAmount = parseFloat(pnlValue || '0');
                                    
                                    // Calculate balance: Deposit - Withdraw + P&L (same as Add form)
                                    const newBalance = depositAmount - withdrawAmount + pnlAmount;
                                    
                                    setEditTransactionForm({ 
                                      ...editTransactionForm, 
                                      pnl: pnlValue,
                                      remainingBalance: newBalance.toFixed(2)
                                    });
                                  }}
                                  className={`pr-12 h-10 ${
                                    editTransactionForm.pnl && !isNaN(parseFloat(editTransactionForm.pnl)) 
                                      ? parseFloat(editTransactionForm.pnl) >= 0 
                                        ? 'border-green-300 focus:border-green-500' 
                                        : 'border-red-300 focus:border-red-500'
                                      : ''
                                  }`}
                                />
                                {editTransactionForm.pnl && !isNaN(parseFloat(editTransactionForm.pnl)) && (
                                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                    {parseFloat(editTransactionForm.pnl) >= 0 ? (
                                      <TrendingUp className="w-4 h-4 text-green-600" />
                                    ) : (
                                      <TrendingDown className="w-4 h-4 text-red-600" />
                                    )}
                                  </div>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-1.5">
                                Use + for profit, - for loss
                              </p>
                            </div>
                            
                            <div className="space-y-1.5">
                              <Label htmlFor="edit-remainingBalance" className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-2">
                                <div className="w-5 h-5 rounded bg-blue-100 flex items-center justify-center flex-shrink-0">
                                  <Wallet className="w-3 h-3 text-blue-700" />
                                </div>
                                Remaining Balance
                              </Label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-sm">$</span>
                                <Input
                                  id="edit-remainingBalance"
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  value={editTransactionForm.remainingBalance}
                                  readOnly
                                  className={`pl-8 pr-12 h-10 bg-gray-50 cursor-not-allowed ${
                                    editTransactionForm.remainingBalance && parseFloat(editTransactionForm.remainingBalance) < 0
                                      ? 'border-red-300 text-red-600'
                                      : editTransactionForm.remainingBalance && parseFloat(editTransactionForm.remainingBalance) > 0
                                      ? 'border-green-300 text-green-600'
                                      : ''
                                  }`}
                                />
                                {editTransactionForm.remainingBalance && parseFloat(editTransactionForm.remainingBalance) !== 0 && (
                                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                    {parseFloat(editTransactionForm.remainingBalance) >= 0 ? (
                                      <TrendingUp className="w-4 h-4 text-green-600" />
                                    ) : (
                                      <TrendingDown className="w-4 h-4 text-red-600" />
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-end pt-5 mt-5 border-t">
                      <div className="flex items-center gap-3">
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={() => setIsEditTransactionDialogOpen(false)}
                          className="h-10 px-6"
                        >
                          Cancel
                        </Button>
                        <Button 
                          type="submit" 
                          className="bg-[#6a40ec] hover:bg-[#5a2fd9] h-10 px-6"
                          disabled={isSubmittingTransaction}
                        >
                          {isSubmittingTransaction ? (
                            <>
                              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Updating...
                            </>
                          ) : (
                            <>
                              <Edit2 className="w-4 h-4 mr-2" />
                              Update Transaction
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </form>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Dashboard Cards */}
      {(() => {
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
                      {metrics.transactionCount} transactions
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
                    {formatCurrency(metrics.totalWithdrawals)}
                  </div>
                  <div className="flex items-center justify-start">
                    <div className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tracking-wide bg-gray-100 text-gray-700 border border-gray-200">
                      Net: {formatCurrency(metrics.netBalance)}
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
                    Total Bank Balance
                  </CardTitle>
                </div>
                <div className="flex-shrink-0 p-2 bg-gradient-to-br from-blue-400/15 via-blue-400/20 to-blue-400/25 rounded-lg shadow-sm border border-blue-400/20 group-hover:shadow-md group-hover:scale-110 transition-all duration-300">
                  <Wallet className="h-4 w-4 text-blue-600 drop-shadow-sm" />
                </div>
              </CardHeader>
              <CardContent className="relative px-4 pb-4 pt-1">
                <div className="space-y-2">
                  <div className="text-2xl font-bold text-blue-600 tracking-tight leading-none">
                    {formatCurrency(metrics.totalRemaining)}
                  </div>
                  <div className="flex items-center justify-start">
                    <div className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tracking-wide bg-blue-100 text-blue-700 border border-blue-200">
                      Across {metrics.activeBanks} banks
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
                    Largest Bank
                  </CardTitle>
                </div>
                <div className="flex-shrink-0 p-2 bg-gradient-to-br from-[#6a40ec]/15 via-[#6a40ec]/20 to-[#6a40ec]/25 rounded-lg shadow-sm border border-[#6a40ec]/20 group-hover:shadow-md group-hover:scale-110 transition-all duration-300">
                  <TrendingUp className="h-4 w-4 text-[#6a40ec] drop-shadow-sm" />
                </div>
              </CardHeader>
              <CardContent className="relative px-4 pb-4 pt-1">
                <div className="space-y-2">
                  <div className="text-2xl font-bold text-[#6a40ec] tracking-tight leading-none">
                    {formatCurrency(metrics.largestBalance.balance)}
                  </div>
                  <div className="flex items-center justify-start">
                    <div className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tracking-wide bg-purple-100 text-purple-700 border border-purple-200">
                      {metrics.largestBalance.bankName}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })()}




      {/* Enhanced Filtering and Search Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Filters & Search</span>
            <div className="text-sm text-gray-500">
              Showing {filteredTransactions.length} of {getFilteredBankTransactions().length} transactions
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            {/* Search Input */}
            <div className="flex-1 min-w-[250px]">
              <Label className="mb-2 block">Search Transactions</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search by bank, amount, submitter..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Bank Filter */}
            <div>
              <Label className="mb-2 block">Filter by Bank</Label>
              <Select value={bankFilter} onValueChange={setBankFilter}>
                <SelectTrigger className="w-48">
                  <Building2 className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="All Banks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Banks</SelectItem>
                  {banks.map((bank) => (
                    <SelectItem key={bank.id} value={bank.id}>
                      {bank.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sort By */}
            <div>
              <Label className="mb-2 block">Sort By</Label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-48">
                  <ArrowUpDown className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date-desc">Date (Newest)</SelectItem>
                  <SelectItem value="date-asc">Date (Oldest)</SelectItem>
                  <SelectItem value="deposit-desc">Deposit (Highest)</SelectItem>
                  <SelectItem value="deposit-asc">Deposit (Lowest)</SelectItem>
                  <SelectItem value="withdraw-desc">Withdraw (Highest)</SelectItem>
                  <SelectItem value="withdraw-asc">Withdraw (Lowest)</SelectItem>
                  <SelectItem value="remaining-desc">Balance (Highest)</SelectItem>
                  <SelectItem value="remaining-asc">Balance (Lowest)</SelectItem>
                  <SelectItem value="bank-asc">Bank (A-Z)</SelectItem>
                  <SelectItem value="bank-desc">Bank (Z-A)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Staff Filter (only show for admins) */}
            {canViewAllEntries() && (
              <div>
                <Label className="mb-2 block">Filter by Staff</Label>
                <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                  <SelectTrigger className="w-48">
                    <User className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="All Staff" />
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

            {/* Clear All Filters */}
            {hasActiveFilters && (
              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={clearAllFilters}
                  className="flex items-center space-x-2"
                >
                  <X className="h-4 w-4" />
                  <span>Clear Filters</span>
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Bank Transactions</CardTitle>
          <CardDescription>All bank transactions showing submitter information and transaction details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Submitted By</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead>Deposit</TableHead>
                  <TableHead>Withdraw</TableHead>
                  <TableHead>P&L</TableHead>
                  <TableHead>Remaining Balance</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedTransactions.map((transaction, index) => {
                  const bank = banks.find(b => b.id === transaction.bankId);
                  const isEven = index % 2 === 0;
                  const pnlValue = transaction.pnl || 0;
                  return (
                    <TableRow
                      key={transaction.id}
                      className={isEven ? 'bg-gray-50' : 'bg-white'}
                    >
                      <TableCell className="font-medium">
                        {new Date(transaction.date).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {transaction.submittedByName}
                      </TableCell>
                      <TableCell className="font-medium">
                        {bank?.name || 'Unknown Bank'}
                      </TableCell>
                      <TableCell className="text-green-600">
                        {transaction.deposit > 0 ? formatCurrency(transaction.deposit) : '-'}
                      </TableCell>
                      <TableCell className="text-red-600">
                        {transaction.withdraw > 0 ? formatCurrency(transaction.withdraw) : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {transaction.pnl !== undefined && transaction.pnl !== null ? (
                            <>
                              <span className={transaction.pnl >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                                {transaction.pnl >= 0 ? '+' : ''}{formatCurrency(transaction.pnl)}
                              </span>
                              {transaction.pnl > 0 ? (
                                <TrendingUp className="w-4 h-4 text-green-600" />
                              ) : transaction.pnl < 0 ? (
                                <TrendingDown className="w-4 h-4 text-red-600" />
                              ) : null}
                            </>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className={transaction.remaining >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {formatCurrency(transaction.remaining)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {canEditTransaction(transaction) ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEditTransaction(transaction)}
                                  className="text-[#6a40ec] hover:text-[#5a2fd9] hover:bg-[#6a40ec]/10"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit transaction</TooltipContent>
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
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {canViewAllEntries() ? "No edit permission" : "Can only edit your own transactions"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          
                          {canDeleteTransaction(transaction) ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteTransaction(transaction.id)}
                                  className="text-red-600 hover:text-red-800"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete transaction</TooltipContent>
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
                                {canViewAllEntries() ? "No delete permission" : "Can only delete your own transactions"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {paginatedTransactions.length > 0 && (
                  <TableRow className="bg-gray-50 hover:bg-gray-50 border-t-2 border-gray-300">
                    <TableCell className="font-bold text-left" colSpan={3}>Total</TableCell> 
                    <TableCell className="font-semibold text-green-600 text-left">
                      {formatCurrency(paginatedTransactions.reduce((sum, t) => sum + (t.deposit || 0), 0))}
                    </TableCell>
                    <TableCell className="font-semibold text-red-600 text-left">
                      {formatCurrency(paginatedTransactions.reduce((sum, t) => sum + (t.withdraw || 0), 0))}
                    </TableCell>
                    <TableCell className={`font-semibold text-left ${paginatedTransactions.reduce((sum, t) => sum + (t.pnl || 0), 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {paginatedTransactions.reduce((sum, t) => sum + (t.pnl || 0), 0) >= 0 ? '+' : ''}{formatCurrency(paginatedTransactions.reduce((sum, t) => sum + (t.pnl || 0), 0))}
                    </TableCell>
                    <TableCell className={`font-semibold text-left ${paginatedTransactions.reduce((sum, t) => sum + t.remaining, 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(paginatedTransactions.reduce((sum, t) => sum + t.remaining, 0))}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {paginatedTransactions.length === 0 && (
              <div className="text-center py-8">
                <p className="text-gray-500">No bank transactions found matching your criteria.</p>
              </div>
            )}
          </div>
          
          {filteredTransactions.length > 0 && (
            <TablePagination
              totalItems={filteredTransactions.length}
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
      <DeleteConfirmationDialog />
      </div>
    </TooltipProvider>
  );
}