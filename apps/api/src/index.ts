import { ApolloServer, gql } from 'apollo-server'
import { PrismaClient } from '../generated/prisma'
import { signToken, hashPassword, comparePassword, verifyToken } from './auth'
import { Request } from 'express'
import axios from 'axios'

const prisma = new PrismaClient()

type GraphQLContext = {
  req: Request
  prisma: PrismaClient
}

const getUserId = (req: Request): string => {
  const auth = req.headers.authorization || ''
  if (!auth.startsWith('Bearer ')) throw new Error('Not authenticated')
  const token = auth.replace('Bearer ', '')
  const payload = verifyToken(token)
  return (payload as any).userId
}

const typeDefs = gql`
  type User {
    id: ID!
    email: String!
    name: String
    students: [Student!]!
  }

  type Student {
    id: ID!
    name: String!
    user: User!
    assignments: [Assignment!]!
    grades: [Grade!]!
    predictions: [Prediction!]!
  }

  type Assignment {
    id: ID!
    fileUrl: String!
    submittedAt: String!
  }

  type Grade {
    id: ID!
    value: Float!
    date: String!
  }

  type Prediction {
    id: ID!
    predictedGrade: Float!
    feedback: String!
    createdAt: String!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type Query {
    users: [User!]!
    students: [Student!]!
    me: User
  }

  type Mutation {
    register(email: String!, name: String, password: String!): AuthPayload!
    login(email: String!, password: String!): AuthPayload!

    createStudent(name: String!): Student!
    updateStudent(id: ID!, name: String!): Student!
    deleteStudent(id: ID!): Boolean!

    createAssignment(studentId: ID!, fileUrl: String!): Assignment!
    deleteAssignment(id: ID!): Boolean!

    addGrade(studentId: ID!, value: Float!, date: String!): Grade!
    deleteGrade(id: ID!): Boolean!

    createPrediction(studentId: ID!, predictedGrade: Float!, feedback: String!): Prediction!
  }
`

const resolvers: Record<string, any> = {
  Query: {
    users: () => prisma.user.findMany(),
    students: () => prisma.student.findMany(),
    me: async (_: any, __: any, { req }: GraphQLContext) => {
      const userId = getUserId(req)
      return prisma.user.findUnique({ where: { id: userId } })
    }
  },

  Mutation: {
    register: async (_parent: any, { email, name, password }: any) => {
      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) throw new Error('Email already in use')

      const hashed = await hashPassword(password)
      const user = await prisma.user.create({
        data: { email, name, password: hashed }
      })

      const token = signToken({ userId: user.id })
      const { password: _, ...safeUser } = user
      return { token, user: safeUser }
    },

    login: async (_args: any, { email, password }: any) => {
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          password: true
        }
      })

      if (!user || !user.password) throw new Error('Invalid credentials')

      const isValid = await comparePassword(password, user.password)
      if (!isValid) throw new Error('Invalid password')

      const token = signToken({ userId: user.id })
      const { password: _, ...safeUser } = user
      return { token, user: safeUser }
    },

    createStudent: async (_: any, { name }: any, { req }: GraphQLContext) => {
      const userId = getUserId(req)
      return prisma.student.create({
        data: {
          name,
          user: { connect: { id: userId } }
        }
      })
    },

    updateStudent: async (_: any, { id, name }: any) => {
      return prisma.student.update({ where: { id }, data: { name } })
    },

    deleteStudent: async (_: any, { id }: any) => {
      await prisma.student.delete({ where: { id } })
      return true
    },

    createAssignment: async (_: any, { studentId, fileUrl }: any) => {
      return prisma.assignment.create({
        data: {
          fileUrl,
          student: { connect: { id: studentId } }
        }
      })
    },

    deleteAssignment: async (_: any, { id }: any) => {
      await prisma.assignment.delete({ where: { id } })
      return true
    },

    addGrade: async (_: any, { studentId, value, date }: any) => {
      return prisma.grade.create({
        data: {
          value,
          date: new Date(date),
          student: { connect: { id: studentId } }
        }
      })
    },

    deleteGrade: async (_: any, { id }: any) => {
      await prisma.grade.delete({ where: { id } })
      return true
    },

    createPrediction: async (_: any, { studentId }: any, { req, prisma }: GraphQLContext) => {
      const userId = getUserId(req)
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: { grades: true, assignments: true }
      })
      if (!student || student.userId !== userId) throw new Error('Not authorized')

      const response = await axios.post('http://localhost:5000/predict', {
        grades: student.grades,
        assignments: 5,
        attendance: 92 // Replace with actual logic
      })

      const { predictedGrade, feedback } = response.data

      return prisma.prediction.create({
        data: {
          predictedGrade,
          feedback,
          student: { connect: { id: studentId } }
        }
      })
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: ({ req }: { req: Request }) => ({ req, prisma })
})

server.listen().then(({ url }) => {
  console.log(`🚀 Server ready at ${url}`)
})