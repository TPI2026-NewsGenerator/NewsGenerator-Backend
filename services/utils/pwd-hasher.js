//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: pwd-hasher.js
//  Description: password salt hashing and verification from bcrypt
//

import bcrypt from 'bcrypt'

export const hashWithSalt = async (password) => {
    const saltRounds = 12 // 2^12 iterations
    const hash = await bcrypt.hash(password, saltRounds)

    return hash
}

export const verifyPassword = async (password, hash) => {
    const match = await bcrypt.compare(password, hash)
    return match
}