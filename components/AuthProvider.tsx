"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, signOut, fetchAuthSession } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";

interface AuthContextType {
    isAuthenticated: boolean;
    user: any | null;
    logout: () => Promise<void>;
    login: (password?: string) => boolean;
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState<any | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        checkAuthStatus(); // Check on mount

        // Listen for auth events
        const listener = Hub.listen('auth', (data: any) => {
            switch (data.payload.event) {
                case 'signedIn':
                    checkAuthStatus();
                    break;
                case 'signedOut':
                    setUser(null);
                    setIsAuthenticated(false);
                    router.push("/login");
                    break;
            }
        });

        return () => listener();
    }, []);

    const checkAuthStatus = async () => {
        try {
            const user = await getCurrentUser();
            const session = await fetchAuthSession();
            setIsAuthenticated(!!user && !!session.tokens);
            setUser(user);
        } catch (error) {
            setIsAuthenticated(false);
            setUser(null);
        } finally {
            setIsLoading(false);
        }
    };

    const logout = async () => {
        try {
            await signOut();
            // Hub will handle the state update
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    // Removed manual login function as we use Amplify Authenticator check
    const login = () => {
        console.warn("Login should be handled by Authenticator");
        return false;
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated, user, logout, login, isLoading }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
