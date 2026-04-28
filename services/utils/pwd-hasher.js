import bcrypt from 'bcrypt'

const hashPassword = async (password) => {
    const saltRounds = 12
    const hash = await bcrypt.hash(password, saltRounds)
    return hash
}

const verifyPassword = async (password, hash) => {
    const match = await bcrypt.compare(password, hash)
    return match
}