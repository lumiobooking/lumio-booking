import { isBookable, pickerStaff } from './bookable-staff';

describe('technician pickers: the front desk is never a technician', () => {
  it('a receptionist is left out even if the old flag says bookable', () => {
    expect(isBookable({ isActive: true, takesAppointments: true, staffRole: 'RECEPTIONIST' })).toBe(false);
    expect(isBookable({ isActive: true, staffRole: 'WAITER' })).toBe(false);
    expect(isBookable({ isActive: true, staffRole: 'KITCHEN' })).toBe(false);
  });

  it('technicians in; switched off or inactive out; an owner/manager only when switched on', () => {
    expect(isBookable({ isActive: true, takesAppointments: true, staffRole: 'TECHNICIAN' })).toBe(true);
    expect(isBookable({ isActive: true, staffRole: null })).toBe(true);
    expect(isBookable({ isActive: false, staffRole: 'TECHNICIAN' })).toBe(false);
    expect(isBookable({ isActive: true, takesAppointments: false, staffRole: 'TECHNICIAN' })).toBe(false);
    expect(isBookable({ isActive: true, takesAppointments: true, staffRole: 'MANAGER' })).toBe(true);
    expect(isBookable({ isActive: true, takesAppointments: false, staffRole: 'MANAGER' })).toBe(false);
  });

  it('the picker keeps whoever is already chosen so the current value still shows', () => {
    const all = [{ id: 'lisa', isActive: true, staffRole: 'TECHNICIAN' }, { id: 'letan', isActive: true, takesAppointments: true, staffRole: 'RECEPTIONIST' }];
    expect(pickerStaff(all).map((s) => s.id)).toEqual(['lisa']);
    expect(pickerStaff(all, ['letan']).map((s) => s.id)).toEqual(['lisa', 'letan']);
  });
});
