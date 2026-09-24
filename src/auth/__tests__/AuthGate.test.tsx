import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { Text } from 'react-native';
import { useAuth, type AuthStatus } from '../AuthProvider';
import { AuthGate } from '../AuthGate';

jest.mock('expo-splash-screen', () => ({ hideAsync: jest.fn() }));
jest.mock('../AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../components/SignInScreen', () => ({
  SignInScreen: () => {
    const { Text: NativeText } = require('react-native') as typeof import('react-native');
    return <NativeText>Sign in screen</NativeText>;
  },
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const hide = SplashScreen.hideAsync as jest.MockedFunction<typeof SplashScreen.hideAsync>;

function setStatus(status: AuthStatus) {
  mockUseAuth.mockReturnValue({ status } as ReturnType<typeof useAuth>);
}

beforeEach(() => jest.clearAllMocks());

it('holds the splash while authentication is loading', async () => {
  setStatus('loading');
  await render(<AuthGate><Text>App</Text></AuthGate>);
  expect(screen.queryByText('App')).not.toBeOnTheScreen();
  expect(hide).not.toHaveBeenCalled();
});

it('shows sign-in after loading and hides the splash', async () => {
  setStatus('signed-out');
  await render(<AuthGate><Text>App</Text></AuthGate>);
  expect(screen.getByText('Sign in screen')).toBeOnTheScreen();
  await waitFor(() => expect(hide).toHaveBeenCalled());
});

it.each(['signed-in', 'disabled'] as AuthStatus[])('shows the app when status is %s', async (status) => {
  setStatus(status);
  await render(<AuthGate><Text>App</Text></AuthGate>);
  expect(screen.getByText('App')).toBeOnTheScreen();
  await waitFor(() => expect(hide).toHaveBeenCalled());
});
