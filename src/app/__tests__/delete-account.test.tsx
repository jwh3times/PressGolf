import React from 'react';
import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { useStore, type AppStore } from '../../store/AppStore';
import DeleteAccountScreen from '../delete-account';

const mockRouter = { back: jest.fn(), replace: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../store/AppStore', () => ({ useStore: jest.fn() }));

const mockDeleteAccount = jest.fn<Promise<void>, [string]>();

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteAccount.mockResolvedValue();
  (useStore as jest.Mock).mockReturnValue({ deleteAccount: mockDeleteAccount } as unknown as AppStore);
  (useAuth as jest.Mock).mockReturnValue({ status: 'signed-in', email: 'golfer@example.com' });
});

const confirmButton = () => screen.getByRole('button', { name: 'Delete my account' });
const passwordField = () => screen.getByLabelText('Password');

describe('what the screen says', () => {
  it('names the account, what goes, what stays, this phone, other phones, and that it is final', async () => {
    await render(<DeleteAccountScreen />);

    expect(screen.getByText(/golfer@example\.com/)).toBeOnTheScreen();
    expect(screen.getByText(/can’t be undone/)).toBeOnTheScreen();
    expect(screen.getByText(/groups, rosters and rounds/)).toBeOnTheScreen();
    expect(screen.getByText(/greens, maps and hole notes/)).toBeOnTheScreen();
    expect(screen.getByText(/clubs and usual score/)).toBeOnTheScreen();
    expect(screen.getByText(/Outings you organised/)).toBeOnTheScreen();
    expect(screen.getByText(/Scores you typed into someone else’s card/)).toBeOnTheScreen();
    expect(screen.getByText(/This phone goes back to first run/)).toBeOnTheScreen();
    expect(screen.getByText(/demo data stays/)).toBeOnTheScreen();
    expect(screen.getByText(/Other phones signed in to this account/)).toBeOnTheScreen();
  });

  it('names every control', async () => {
    await render(<DeleteAccountScreen />);
    screen.getAllByRole('button').forEach((control) => expect(control).toHaveAccessibleName());
    expect(passwordField().props.secureTextEntry).toBe(true);
  });
});

describe('backing out', () => {
  it.each(['Keep my account', 'Done'])('%s goes back and deletes nothing', async (name) => {
    await render(<DeleteAccountScreen />);
    await userEvent.setup().type(passwordField(), 'hunter22');
    await userEvent.setup().press(screen.getByRole('button', { name }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });
});

describe('confirming', () => {
  it('does nothing until a password is typed', async () => {
    await render(<DeleteAccountScreen />);
    expect(confirmButton()).toBeDisabled();
    await userEvent.setup().press(confirmButton());
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });

  it('hands the store the password as typed', async () => {
    const user = userEvent.setup();
    await render(<DeleteAccountScreen />);
    await user.type(passwordField(), ' hunter22 ');
    await user.press(confirmButton());
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    expect(mockDeleteAccount).toHaveBeenCalledWith(' hunter22 ');
  });

  it('holds the screen while the server works, so it cannot be sent twice or left half way', async () => {
    let finish!: () => void;
    mockDeleteAccount.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    await render(<DeleteAccountScreen />);
    await user.type(passwordField(), 'hunter22');
    await user.press(confirmButton());

    expect(screen.getByLabelText('Deleting your account')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Delete my account' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Keep my account' })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Done' }));
    expect(mockRouter.back).not.toHaveBeenCalled();

    await act(async () => finish());
  });

  it('leaves first run to the gate on success, showing no error', async () => {
    const user = userEvent.setup();
    await render(<DeleteAccountScreen />);
    await user.type(passwordField(), 'hunter22');
    await user.press(confirmButton());
    await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});

describe('when it fails', () => {
  const MESSAGE = 'That password is not right. Nothing has been deleted.';
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(jest.fn());

  async function failWith(error: unknown) {
    mockDeleteAccount.mockRejectedValueOnce(error);
    const user = userEvent.setup();
    await render(<DeleteAccountScreen />);
    await user.type(passwordField(), 'hunter22');
    await user.press(confirmButton());
    return user;
  }

  it('shows the message as an alert, and stays on the screen to try again', async () => {
    const user = await failWith(new Error(MESSAGE));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(MESSAGE);
    expect(alert.props.accessibilityLiveRegion).toBe('assertive');
    expect(mockRouter.back).not.toHaveBeenCalled();

    await user.press(confirmButton());
    expect(mockDeleteAccount).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeOnTheScreen());
  });

  it.each(['ios', 'android'] as const)('announces it on %s', async (os) => {
    const original = Platform.OS;
    Platform.OS = os;
    await failWith(new Error(MESSAGE));
    await screen.findByRole('alert');
    expect(announce).toHaveBeenCalledWith(MESSAGE);
    Platform.OS = original;
  });

  it('still says something if what came back was not an error', async () => {
    await failWith('nope');
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not delete/i);
  });
});
