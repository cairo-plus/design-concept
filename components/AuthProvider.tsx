"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, signOut, fetchAuthSession } from "aws-amplify/auth";

interface AuthContextType {
    isAuthenticated: boolean;
    user: any | null;
    logout: () => Promise<void>;
    login: (password: string) => boolean;
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState<any | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        checkAuthStatus();
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
            // Don't redirect here, just set state. Protected routes should handle redirection.
        } finally {
            setIsLoading(false);
        }
    };

    const logout = async () => {
        try {
            await signOut();
            setUser(null);
            setIsAuthenticated(false);
            router.push("/login");
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    const login = (password: string) => {
        if (password === "cairo") {
            setIsAuthenticated(true);
            return true;
        }
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
