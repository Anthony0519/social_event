const User = require("./models/userModel")

const data = [
    {
        fullName: "Anthony Odoh",
        email: "anthony@gmail.com",
        password: "Odoh123",
    },
    {
        fullName: "Tochukwu Odoh",
        email: "tochukwu@gmail.com",
        password: "Odoh123"
    },
    {
        fullName: "Ebuka Ossai",
        email: "ebule@gmail.com",
        password: "Ossai123"
    },
    {
        fullName: "Precious Ossai",
        email: "precious@gmail.com",
        password: "Ossai123"
    },
    {
        fullName: "Favour Ossai",
        email: "favour@gmail.com",
        password: "Ossai123"
    },
    {
        fullName: "Osinachi Ossai",
        email: "osii@gmail.com",
        password: "Ossai123"
    },
    {
        fullName: "Munachi Ossai",
        email: "munaa@gmail.com",
        password: "Ossai123"
    },
]

const createUser = async (data)=>{
    for (const user in data){
        const insertData = await User.create(user)
        console.log(insertData)
    }
}
createUser(data)