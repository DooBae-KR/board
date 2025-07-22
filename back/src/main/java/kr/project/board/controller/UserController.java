package kr.project.board.controller;

import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import kr.project.board.Service.UserService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;


@RestController
@RequestMapping("/api")
public class UserController {

    private UserService userService;


    @PostMapping("/user/regist")
    public ResponseEntity<String> registUser(@RequestBody kr.project.board.domain.UserDTO dto) {
        userService.regist(dto);

        return ResponseEntity.ok("회원가입 완료");
        
    }
    
    
}
